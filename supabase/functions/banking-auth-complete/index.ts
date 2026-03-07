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
    const body = await req.json()
    const { code, user_id } = body
    if (!code) return respond(400, { error: 'code обязателен' })
    if (!user_id) return respond(400, { error: 'user_id не передан — пользователь не авторизован' })

    const privateKey = Deno.env.get('EB_PRIVATE_KEY')
    const appId = Deno.env.get('EB_APP_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!appId || !privateKey) return respond(400, { error: 'Секреты EB_APP_ID / EB_PRIVATE_KEY не настроены' })

    const jwt = await createJWT(privateKey, appId)
    const ebHeaders = { 'Authorization': 'Bearer '+jwt, 'Content-Type': 'application/json' }

    // 1. Exchange code for session
    const sessRes = await fetch('https://api.enablebanking.com/sessions', {
      method: 'POST', headers: ebHeaders, body: JSON.stringify({ code })
    })
    const sessText = await sessRes.text()
    if (!sessRes.ok) {
      return respond(400, { error: 'Ошибка создания сессии: '+sessRes.status, detail: sessText })
    }
    const sessData = JSON.parse(sessText)
    const sessionId = sessData.session_id
    const accounts = sessData.accounts || []

    const debug = {
      session_id: sessionId,
      accounts_count: accounts.length,
      accounts_uids: accounts.map(a => a.uid),
      raw_accounts: accounts,
    }

    if (accounts.length === 0) {
      return respond(200, { imported: 0, total: 0, debug, note: 'Нет счетов в сессии' })
    }

    // 2. Fetch transactions from each account (all history from 2020-01-01)
    const dateFrom = '2020-01-01'
    const allTx = []
    const txDebug = []

    for (const acc of accounts) {
      const uid = acc.uid
      if (!uid) continue
      const txUrl = `https://api.enablebanking.com/accounts/${uid}/transactions?date_from=${dateFrom}&transaction_status=BOOK`
      const txRes = await fetch(txUrl, { headers: ebHeaders })
      const txText = await txRes.text()
      let txData = {}
      try { txData = JSON.parse(txText) } catch {}
      txDebug.push({ uid, status: txRes.status, count: (txData.transactions||[]).length, error: txRes.ok ? null : txText.slice(0,300) })

      if (!txRes.ok) continue
      const iban = acc.account_id?.iban || acc.iban || ''
      for (const tx of (txData.transactions || [])) {
        const amount = parseFloat(tx.transaction_amount?.amount || tx.amount || '0')
        const debit = tx.credit_debit_indicator === 'DBIT' || amount < 0
        allTx.push({
          date: tx.booking_date || tx.value_date || dateFrom,
          amount: Math.abs(amount),
          description: Array.isArray(tx.remittance_information)
            ? tx.remittance_information.join(' ')
            : (tx.remittance_information || tx.debtor?.name || tx.creditor?.name || 'PKO BP'),
          type: debit ? 'expense' : 'income',
          source: 'pko_bp',
          external_id: tx.entry_reference || tx.transaction_id || null,
          iban,
        })
      }
    }

    debug.tx_debug = txDebug
    debug.total_txs = allTx.length

    // 3. Insert into Supabase (skip duplicates by external_id)
    let imported = 0
    let insertError = null

    if (supabaseUrl && supabaseKey && allTx.length > 0) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)

      // Get existing external_ids for this user to skip duplicates
      const { data: existing } = await db.from('transactions')
        .select('external_id')
        .eq('user_id', user_id)
        .not('external_id','is',null)
      const existingIds = new Set((existing||[]).map(r => r.external_id))

      const newTx = allTx.filter(t => !t.external_id || !existingIds.has(t.external_id))

      if (newTx.length > 0) {
        const { error } = await db.from('transactions').insert(
          newTx.map(t => ({
            user_id,
            date: t.date,
            amount: t.amount,
            description: t.description,
            type: t.type,
            source: 'pko_bp',
            external_id: t.external_id || null,
          }))
        )
        insertError = error ? String(error.message) : null
        if (!error) imported = newTx.length
      }
    }

    return respond(200, {
      session_id: sessionId,
      imported,
      total: allTx.length,
      debug,
      insert_error: insertError,
    })
  } catch(e) {
    return respond(500, { error: String(e) })
  }
})
