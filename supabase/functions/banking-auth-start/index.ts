const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function base64url(buf) {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function normalizePem(raw) {
  let pem = raw.replace(/\\n/g, '\n')
  if (!pem.includes('-----BEGIN')) {
    pem = '-----BEGIN PRIVATE KEY-----\n' + pem + '\n-----END PRIVATE KEY-----'
  }
  return pem.trim()
}

async function createJWT(privateKeyPem, appId) {
  const normalized = normalizePem(privateKeyPem)
  const pemBody = normalized
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '')

  const derBuf = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', derBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256', kid: appId }
  const payload = { iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }

  const headerB64  = b64urlEncode(JSON.stringify(header))
  const payloadB64 = b64urlEncode(JSON.stringify(payload))
  const sigInput   = headerB64 + '.' + payloadB64

  const sigBuf = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(sigInput))
  return sigInput + '.' + base64url(sigBuf)
}

const respond = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { redirect_uri, state, aspsp_name, list_banks } = body

    const privateKey = Deno.env.get('EB_PRIVATE_KEY')
    const appId      = Deno.env.get('EB_APP_ID')

    if (!appId)      return respond(400, { error: 'Секрет EB_APP_ID не найден в Supabase Edge Functions Secrets' })
    if (!privateKey) return respond(400, { error: 'Секрет EB_PRIVATE_KEY не найден в Supabase Edge Functions Secrets' })

    let jwt
    try { jwt = await createJWT(privateKey, appId) }
    catch (e) { return respond(400, { error: 'Ошибка JWT (проверьте EB_PRIVATE_KEY): ' + String(e) }) }

    // Mode: list all Polish banks
    if (list_banks) {
      const aspspListRes = await fetch('https://api.enablebanking.com/aspsps?country=PL', {
        headers: { 'Authorization': 'Bearer ' + jwt },
      })
      if (!aspspListRes.ok) {
        return respond(400, { error: 'Не удалось получить список банков: ' + aspspListRes.status })
      }
      const aspspData = await aspspListRes.json()
      const banks = (aspspData.aspsps || []).map((a: any) => ({
        name: a.name,
        country: a.country,
        bic: a.bic || null,
        logo: a.logo || null,
        beta: a.beta || false,
        psu_types: a.psu_types || [],
      }))
      return respond(200, { banks })
    }

    // Mode: start auth for a specific bank
    // Get the exact ASPSP name from Enable Banking
    const aspspListRes = await fetch('https://api.enablebanking.com/aspsps?country=PL', {
      headers: { 'Authorization': 'Bearer ' + jwt },
    })
    let aspspName = aspsp_name || 'PKO Bank Polski SA'
    if (aspspListRes.ok) {
      const aspspData = await aspspListRes.json()
      const allAspsps = aspspData.aspsps || []

      // Normalize for matching: lowercase, remove SA/S.A., trim
      const norm = (s) => (s || '').toLowerCase().replace(/\bs\.?a\.?\b/g, '').replace(/\s+/g, ' ').trim()
      const inputNorm = norm(aspsp_name)

      // Try exact match first
      let found = allAspsps.find((a: any) => a.name === aspsp_name)
      // Try normalized exact match
      if (!found && aspsp_name) {
        found = allAspsps.find((a: any) => norm(a.name) === inputNorm)
      }
      // Try bidirectional partial match (either name contains the other)
      if (!found && aspsp_name) {
        found = allAspsps.find((a: any) => {
          const aN = norm(a.name)
          return aN.includes(inputNorm) || inputNorm.includes(aN)
        })
      }
      if (!found) {
        // Fallback to PKO
        found = allAspsps.find((a: any) =>
          a.name?.toLowerCase().includes('pko') || a.name?.toLowerCase().includes('powszechna')
        )
      }
      if (found) aspspName = found.name
    }

    const authResponse = await fetch('https://api.enablebanking.com/auth', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access: {
          valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
        aspsp: { name: aspspName, country: 'PL' },
        state: state || crypto.randomUUID(),
        redirect_url: redirect_uri,
        psu_type: 'personal',
      }),
    })

    const respText = await authResponse.text()
    if (!authResponse.ok) {
      let detail = respText
      try { detail = JSON.stringify(JSON.parse(respText)) } catch { /* keep raw */ }
      return respond(400, { error: 'Enable Banking API ' + authResponse.status, detail })
    }

    const data = JSON.parse(respText)
    return respond(200, { url: data.url, authorization_id: data.authorization_id, aspsp_name: aspspName })

  } catch (e) {
    return respond(500, { error: String(e) })
  }
})
