// GoCardless Bank Account Data — sync transactions
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const GC_BASE = 'https://bankaccountdata.gocardless.com'

const respond = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
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
  if (!res.ok) throw new Error(`Token error ${res.status}: ${await res.text()}`)
  return (await res.json()).access
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { user_id, bank_name } = await req.json()
    if (!user_id) return respond(400, { error: 'user_id обязателен' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseKey) return respond(500, { error: 'SUPABASE_URL / SERVICE_ROLE_KEY не настроены' })

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const db = createClient(supabaseUrl, supabaseKey)

    let query = db.from('bank_connections')
      .select('session_id, accounts, last_sync_at, bank_name')
      .eq('user_id', user_id)
    if (bank_name) query = query.eq('bank_name', bank_name)

    const { data: connections, error: connErr } = await query
    if (connErr || !connections || connections.length === 0) {
      return respond(404, { error: bank_name ? `Банк ${bank_name} не подключён.` : 'Нет подключённых банков.' })
    }

    const token = await getAccessToken()
    const gcHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

    let totalImported = 0
    let totalTx = 0
    const allSyncDebug: any[] = []

    for (const conn of connections) {
      const connBankName = conn.bank_name || 'Банк'
      const source = connBankName.toLowerCase().replace(/\s+/g, '_')
      let accounts = conn.accounts || []
      const requisitionId = conn.session_id

      // If no accounts saved, try refreshing from the requisition
      if (accounts.length === 0 && requisitionId) {
        try {
          const reqRes = await fetch(`${GC_BASE}/api/v2/requisitions/${requisitionId}/`, { headers: gcHeaders })
          if (reqRes.ok) {
            const reqData = await reqRes.json()
            const accountIds = reqData.accounts || []
            accounts = accountIds.map((id: string) => ({ uid: id }))
            if (accounts.length > 0) {
              await db.from('bank_connections').update({ accounts })
                .eq('user_id', user_id).eq('bank_name', connBankName)
            }
          }
        } catch (e) {
          allSyncDebug.push({ bank: connBankName, error: String(e) })
        }
      }

      if (accounts.length === 0) {
        allSyncDebug.push({ bank: connBankName, error: 'Нет счетов. Попробуйте переподключить банк.' })
        continue
      }

      const dateFrom = conn.last_sync_at
        ? new Date(conn.last_sync_at).toISOString().split('T')[0]
        : '2020-01-01'

      const allTx: any[] = []
      const syncDebug: any[] = []

      for (const acc of accounts) {
        const accId = acc.uid
        if (!accId) continue
        try {
          const txRes = await fetch(`${GC_BASE}/api/v2/accounts/${accId}/transactions/?date_from=${dateFrom}`, { headers: gcHeaders })
          const txText = await txRes.text()
          if (!txRes.ok) {
            syncDebug.push({ accId, status: txRes.status, error: txText.slice(0, 200) })
            continue
          }
          const txData = JSON.parse(txText)
          const booked = txData.transactions?.booked || []

          for (const tx of booked) {
            const amount = parseFloat(tx.transactionAmount?.amount || '0')
            allTx.push({
              date: tx.bookingDate || tx.valueDate || dateFrom,
              amount: Math.abs(amount),
              description: tx.remittanceInformationUnstructured
                || tx.remittanceInformationUnstructuredArray?.join(' ')
                || tx.debtorName || tx.creditorName || connBankName,
              type: amount < 0 ? 'expense' : 'income',
              external_id: tx.transactionId || tx.internalTransactionId || null,
            })
          }
          syncDebug.push({ accId, booked: booked.length })
        } catch (e) {
          syncDebug.push({ accId, error: String(e) })
        }
      }

      // Insert new transactions
      let imported = 0
      let insertError = null

      if (allTx.length > 0) {
        const { data: existing } = await db.from('transactions')
          .select('external_id')
          .eq('user_id', user_id)
          .not('external_id', 'is', null)
        const existingIds = new Set((existing || []).map(r => r.external_id))

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

      await db.from('bank_connections').update({
        last_sync_at: new Date().toISOString()
      }).eq('user_id', user_id).eq('bank_name', connBankName)

      totalImported += imported
      totalTx += allTx.length
      allSyncDebug.push({ bank: connBankName, imported, total: allTx.length, insert_error: insertError, debug: syncDebug })
    }

    return respond(200, {
      imported: totalImported,
      total: totalTx,
      banks: connections.map(c => c.bank_name),
      debug: allSyncDebug,
    })
  } catch (e) {
    return respond(500, { error: String(e) })
  }
})
