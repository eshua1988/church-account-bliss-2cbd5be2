// GoCardless Bank Account Data — auth start & list banks
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const GC_BASE = 'https://bankaccountdata.gocardless.com'

const respond = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

async function getAccessToken() {
  const secretId = Deno.env.get('GC_SECRET_ID')
  const secretKey = Deno.env.get('GC_SECRET_KEY')
  if (!secretId || !secretKey) throw new Error('GC_SECRET_ID / GC_SECRET_KEY не настроены')

  const res = await fetch(`${GC_BASE}/api/v2/token/new/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: secretId, secret_key: secretKey }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token error ${res.status}: ${text}`)
  }
  const data = await res.json()
  return data.access
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { redirect_uri, state, institution_id, list_banks, country } = body

    const token = await getAccessToken()
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

    // Mode: list banks for a country
    if (list_banks) {
      const c = country || 'PL'
      const res = await fetch(`${GC_BASE}/api/v2/institutions/?country=${c}`, { headers })
      if (!res.ok) return respond(400, { error: 'Не удалось получить список банков: ' + res.status })
      const banks = await res.json()
      return respond(200, {
        banks: banks.map((b: any) => ({
          id: b.id,
          name: b.name,
          bic: b.bic || null,
          logo: b.logo || null,
          transaction_total_days: b.transaction_total_days || '90',
          countries: b.countries || [],
        })),
      })
    }

    // Mode: start auth — create requisition
    if (!institution_id) return respond(400, { error: 'institution_id обязателен' })
    if (!redirect_uri) return respond(400, { error: 'redirect_uri обязателен' })

    // Create end user agreement (max history, 90 days access)
    const agreementRes = await fetch(`${GC_BASE}/api/v2/agreements/enduser/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        institution_id,
        max_historical_days: 730,
        access_valid_for_days: 90,
        access_scope: ['balances', 'details', 'transactions'],
      }),
    })
    let agreementId = null
    if (agreementRes.ok) {
      const agr = await agreementRes.json()
      agreementId = agr.id
    }

    // Create requisition
    const reqBody: any = {
      redirect: redirect_uri,
      institution_id,
      reference: state || crypto.randomUUID(),
      user_language: 'PL',
    }
    if (agreementId) reqBody.agreement = agreementId

    const reqRes = await fetch(`${GC_BASE}/api/v2/requisitions/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(reqBody),
    })
    const reqText = await reqRes.text()
    if (!reqRes.ok) return respond(400, { error: 'Ошибка создания requisition: ' + reqRes.status, detail: reqText })

    const reqData = JSON.parse(reqText)
    return respond(200, {
      url: reqData.link,
      requisition_id: reqData.id,
      institution_id,
    })
  } catch (e) {
    return respond(500, { error: String(e) })
  }
})
