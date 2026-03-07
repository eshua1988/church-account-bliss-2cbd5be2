const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function base64url(buf) {
  const bytes = new Uint8Array(buf); let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function normalizePem(raw) {
  let pem = raw.replace(/\\n/g,'\n')
  if (!pem.includes('-----BEGIN')) pem = '-----BEGIN PRIVATE KEY-----\n'+pem+'\n-----END PRIVATE KEY-----'
  return pem.trim()
}
async function createJWT(privateKeyPem, appId) {
  const body = normalizePem(privateKeyPem).replace(/-----BEGIN [A-Z ]+-----/g,'').replace(/-----END [A-Z ]+-----/g,'').replace(/\s+/g,'')
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign'])
  const now = Math.floor(Date.now()/1000)
  const h = b64urlEncode(JSON.stringify({typ:'JWT',alg:'RS256',kid:appId}))
  const p = b64urlEncode(JSON.stringify({iss:'enablebanking.com',aud:'api.enablebanking.com',iat:now,exp:now+3600}))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h+'.'+p))
  return h+'.'+p+'.'+base64url(sig)
}

const respond = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { code } = await req.json()
    if (!code) return respond(400, { error: 'code обязателен' })

    const privateKey = Deno.env.get('EB_PRIVATE_KEY')
    const appId = Deno.env.get('EB_APP_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!appId || !privateKey) return respond(400, { error: 'Секреты EB_APP_ID / EB_PRIVATE_KEY не настроены' })

    const jwt = await createJWT(privateKey, appId)
    const headers = { 'Authorization': 'Bearer '+jwt, 'Content-Type': 'application/json' }

    // 1. Exchange code for session
    const sessRes = await fetch('https://api.enablebanking.com/sessions', {
      method: 'POST', headers, body: JSON.stringify({ code })
    })
    if (!sessRes.ok) {
      const t = await sessRes.text()
      return respond(400, { error: 'Ошибка создания сессии: '+sessRes.status, detail: t })
    }
    const sessData = await sessRes.json()
    const sessionId = sessData.session_id
    const accounts = sessData.accounts || []

    // 2. Fetch transactions from each account (last 90 days)
    const dateFrom = new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0]
    const allTx = []

    for (const acc of accounts) {
      const uid = acc.uid
      if (!uid) continue
      const txRes = await fetch(
        `https://api.enablebanking.com/accounts/${uid}/transactions?date_from=${dateFrom}&transaction_status=BOOK`,
        { headers }
      )
      if (!txRes.ok) continue
      const txData = await txRes.json()
      const iban = acc.account_id?.iban || ''
      for (const tx of (txData.transactions || [])) {
        const amount = parseFloat(tx.transaction_amount?.amount || '0')
        const debit = tx.credit_debit_indicator === 'DBIT'
        allTx.push({
          date: tx.booking_date || tx.value_date || dateFrom,
          amount: debit ? -Math.abs(amount) : Math.abs(amount),
          description: (tx.remittance_information || []).join(' ') || tx.debtor?.name || tx.creditor?.name || 'PKO BP',
          type: debit ? 'expense' : 'income',
          source: 'pko_bp',
          external_id: tx.entry_reference || tx.transaction_id,
          iban,
        })
      }
    }

    // 3. Insert into Supabase (skip duplicates by external_id)
    let imported = 0
    if (supabaseUrl && supabaseKey && allTx.length > 0) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)
      // Get existing external_ids to skip duplicates
      const { data: existing } = await db.from('transactions')
        .select('external_id').not('external_id','is',null)
      const existingIds = new Set((existing||[]).map(r=>r.external_id))
      const newTx = allTx.filter(t => !t.external_id || !existingIds.has(t.external_id))
      if (newTx.length > 0) {
        const { error } = await db.from('transactions').insert(
          newTx.map(t => ({
            date: t.date,
            amount: Math.abs(t.amount),
            description: t.description,
            type: t.type,
            source: 'pko_bp',
            external_id: t.external_id || null,
          }))
        )
        if (!error) imported = newTx.length
      }
    }

    return respond(200, { session_id: sessionId, imported, total: allTx.length })
  } catch(e) {
    return respond(500, { error: String(e) })
  }
})
