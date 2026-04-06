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
    const { user_id, bank_name } = await req.json()
    if (!user_id) return respond(400, { error: 'user_id обязателен' })

    const privateKey = Deno.env.get('EB_PRIVATE_KEY')
    const appId = Deno.env.get('EB_APP_ID')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!appId || !privateKey) return respond(400, { error: 'Секреты EB_APP_ID / EB_PRIVATE_KEY не настроены' })
    if (!supabaseUrl || !supabaseKey) return respond(500, { error: 'SUPABASE_URL / SERVICE_ROLE_KEY не настроены' })

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const db = createClient(supabaseUrl, supabaseKey)

    // Load saved connections — single bank or all
    let query = db.from('bank_connections')
      .select('session_id, accounts, last_sync_at, bank_name')
      .eq('user_id', user_id)
    if (bank_name) query = query.eq('bank_name', bank_name)

    const { data: connections, error: connErr } = await query

    if (connErr || !connections || connections.length === 0) {
      return respond(404, { error: bank_name ? `Банк ${bank_name} не подключён.` : 'Нет подключённых банков.' })
    }

    const jwt = await createJWT(privateKey, appId)
    const ebHeaders = { 'Authorization': 'Bearer '+jwt, 'Content-Type': 'application/json' }

    let totalImported = 0
    let totalTx = 0
    const allSyncDebug = []

    for (const conn of connections) {
      const connBankName = conn.bank_name || 'PKO BP'
      const source = connBankName.toLowerCase().replace(/\s+/g, '_')
      const accounts = conn.accounts || []
      if (accounts.length === 0) continue

    // Fetch only new transactions since last sync
    const dateFrom = conn.last_sync_at
      ? new Date(conn.last_sync_at).toISOString().split('T')[0]
      : '2020-01-01'

    const allTx = []
    const syncDebug = []

    for (const acc of accounts) {
      const uid = acc.uid
      if (!uid) continue
      let pageCount = 0
      let continuationKey = null
      let totalForAcc = 0

      do {
        const url = new URL(`https://api.enablebanking.com/accounts/${uid}/transactions`)
        url.searchParams.set('date_from', dateFrom)
        url.searchParams.set('transaction_status', 'BOOK')
        if (continuationKey) url.searchParams.set('continuation_key', continuationKey)

        const txRes = await fetch(url.toString(), { headers: ebHeaders })
        const txText = await txRes.text()
        let txData = {}
        try { txData = JSON.parse(txText) } catch {}

        if (!txRes.ok) {
          syncDebug.push({ uid, page: pageCount, status: txRes.status, error: txText.slice(0,200) })
          break
        }

        const pageTxs = txData.transactions || []
        totalForAcc += pageTxs.length

        for (const tx of pageTxs) {
          const amount = parseFloat(tx.transaction_amount?.amount || tx.amount || '0')
          const debit = tx.credit_debit_indicator === 'DBIT' || amount < 0
          allTx.push({
            date: tx.booking_date || tx.value_date || dateFrom,
            amount: Math.abs(amount),
            description: Array.isArray(tx.remittance_information)
              ? tx.remittance_information.join(' ')
              : (tx.remittance_information || tx.debtor?.name || tx.creditor?.name || connBankName),
            type: debit ? 'expense' : 'income',
            external_id: tx.entry_reference || tx.transaction_id || null,
          })
        }

        continuationKey = txData.continuation_key || null
        pageCount++
        if (pageCount >= 50) break
      } while (continuationKey)

      syncDebug.push({ uid, pages: pageCount, total: totalForAcc })
    }

    // Insert new transactions (skip duplicates)
    let imported = 0
    let insertError = null

    if (allTx.length > 0) {
      const { data: existing } = await db.from('transactions')
        .select('external_id')
        .eq('user_id', user_id)
        .not('external_id', 'is', null)
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
            source,
            external_id: t.external_id || null,
          }))
        )
        insertError = error ? String(error.message) : null
        if (!error) imported = newTx.length
      }
    }

    // Update last_sync_at
    await db.from('bank_connections').update({
      last_sync_at: new Date().toISOString()
    }).eq('user_id', user_id).eq('bank_name', connBankName)

    totalImported += imported
    totalTx += allTx.length
    allSyncDebug.push({ bank: connBankName, imported, total: allTx.length, insert_error: insertError, debug: syncDebug })
    } // end for each connection

    return respond(200, {
      imported: totalImported,
      total: totalTx,
      date_from: connections.map(c => c.last_sync_at ? new Date(c.last_sync_at).toISOString().split('T')[0] : '2020-01-01').join(', '),
      banks: connections.map(c => c.bank_name),
      debug: allSyncDebug,
    })
  } catch(e) {
    return respond(500, { error: String(e) })
  }
})
