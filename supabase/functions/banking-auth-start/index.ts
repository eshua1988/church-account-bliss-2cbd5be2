import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── JWT helpers (RS256 via Web Crypto) ──────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createJWT(privateKeyPem: string, appId: string): Promise<string> {
  // Strip PEM headers/footers and decode
  const pemBody = privateKeyPem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '')

  const derBuf = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    derBuf,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const now = Math.floor(Date.now() / 1000)
  const header = { typ: 'JWT', alg: 'RS256', kid: appId }
  const payload = {
    iss: 'enablebanking.com',
    aud: 'api.enablebanking.com',
    iat: now,
    exp: now + 3600,
  }

  const headerB64  = b64urlEncode(JSON.stringify(header))
  const payloadB64 = b64urlEncode(JSON.stringify(payload))
  const sigInput   = `${headerB64}.${payloadB64}`

  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(sigInput),
  )

  return `${sigInput}.${base64url(sigBuf)}`
}

// ─── Main handler ─────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { redirect_uri, state } = await req.json()

    // Read secrets from environment
    const privateKey = Deno.env.get('EB_PRIVATE_KEY')
    const appId      = Deno.env.get('EB_APP_ID')

    if (!privateKey || !appId) {
      return new Response(
        JSON.stringify({ error: 'EB_PRIVATE_KEY или EB_APP_ID не настроены в Supabase Secrets' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const jwt = await createJWT(privateKey, appId)

    // POST to Enable Banking to start authorization
    const authResponse = await fetch('https://api.enablebanking.com/auth', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        access: {
          valid_until: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        },
        aspsp: {
          name: 'PKO BP',
          country: 'PL',
        },
        state: state || crypto.randomUUID(),
        redirect_url: redirect_uri,
        psu_type: 'personal',
      }),
    })

    if (!authResponse.ok) {
      const err = await authResponse.text()
      return new Response(
        JSON.stringify({ error: `Enable Banking API error: ${authResponse.status}`, detail: err }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const data = await authResponse.json()
    // data.url contains the redirect URL
    return new Response(
      JSON.stringify({ url: data.url, authorization_id: data.authorization_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
