// GoCardless Bank Account Data — auth complete (after bank redirect)
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
    const body = await req.json()
    const { requisition_id, user_id, bank_name } = body
    if (!requisition_id) return respond(400, { error: 'requisition_id обязателен' })
    if (!user_id) return respond(400, { error: 'user_id не передан — пользователь не авторизован' })
    const resolvedBankName = bank_name || 'Банк'

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    const token = await getAccessToken()
    const gcHeaders = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

    // 1. Get requisition to find accounts
    const reqRes = await fetch(`${GC_BASE}/api/v2/requisitions/${requisition_id}/`, { headers: gcHeaders })
    const reqText = await reqRes.text()
    if (!reqRes.ok) return respond(400, { error: 'Ошибка получения requisition: ' + reqRes.status, detail: reqText })

    const reqData = JSON.parse(reqText)
    const accountIds: string[] = reqData.accounts || []
    const status = reqData.status

    const debug: any = {
      requisition_id,
      status,
      accounts_count: accountIds.length,
      account_ids: accountIds,
    }

    if (status !== 'LN') {
      return respond(200, { imported: 0, total: 0, debug, note: `Requisition статус: ${status}. Ожидается LN (linked). Возможно авторизация не завершена.` })
    }

    // 2. Get details for each account
    const accountsInfo: any[] = []
    for (const accId of accountIds) {
      try {
        const detRes = await fetch(`${GC_BASE}/api/v2/accounts/${accId}/details/`, { headers: gcHeaders })
        if (detRes.ok) {
          const det = await detRes.json()
          const acc = det.account || det
          accountsInfo.push({
            uid: accId,
            iban: acc.iban || '',
            name: acc.ownerName || acc.name || acc.iban || accId,
            currency: acc.currency || '',
          })
        } else {
          accountsInfo.push({ uid: accId, iban: '', name: accId })
        }
      } catch {
        accountsInfo.push({ uid: accId, iban: '', name: accId })
      }
    }

    // 3. Save bank connection
    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)

      const { error: upsertError } = await db.from('bank_connections').upsert({
        user_id,
        bank_name: resolvedBankName,
        session_id: requisition_id,
        accounts: accountsInfo,
        connected_at: new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      }, { onConflict: 'user_id,bank_name' })
      if (upsertError) {
        console.error('[banking-auth-complete] upsert error:', upsertError)
        debug.upsert_error = upsertError.message
      }

      if (accountIds.length === 0) {
        return respond(200, { imported: 0, total: 0, debug, note: 'Банк подключён, но счета не найдены.' })
      }
    }

    // 4. Fetch transactions from each account
    const dateFrom = '2020-01-01'
    const allTx: any[] = []
    const txDebug: any[] = []

    for (const accId of accountIds) {
      try {
        const txRes = await fetch(`${GC_BASE}/api/v2/accounts/${accId}/transactions/?date_from=${dateFrom}`, { headers: gcHeaders })
        const txText = await txRes.text()
        if (!txRes.ok) {
          txDebug.push({ accId, status: txRes.status, error: txText.slice(0, 300) })
          continue
        }
        const txData = JSON.parse(txText)
        const booked = txData.transactions?.booked || []
        const accInfo = accountsInfo.find(a => a.uid === accId)
        const iban = accInfo?.iban || ''

        for (const tx of booked) {
          const amount = parseFloat(tx.transactionAmount?.amount || '0')
          allTx.push({
            date: tx.bookingDate || tx.valueDate || dateFrom,
            amount: Math.abs(amount),
            description: tx.remittanceInformationUnstructured
              || tx.remittanceInformationUnstructuredArray?.join(' ')
              || tx.debtorName || tx.creditorName || resolvedBankName,
            type: amount < 0 ? 'expense' : 'income',
            source: resolvedBankName.toLowerCase().replace(/\s+/g, '_'),
            external_id: tx.transactionId || tx.internalTransactionId || null,
            iban,
          })
        }
        txDebug.push({ accId, booked: booked.length })
      } catch (e) {
        txDebug.push({ accId, error: String(e) })
      }
    }

    debug.tx_debug = txDebug
    debug.total_txs = allTx.length

    // 5. Insert into Supabase (skip duplicates)
    let imported = 0
    let insertError = null

    if (supabaseUrl && supabaseKey && allTx.length > 0) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)

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
            source: t.source,
            external_id: t.external_id || null,
          }))
        )
        insertError = error ? String(error.message) : null
        if (!error) imported = newTx.length
      }
    }

    return respond(200, {
      requisition_id,
      imported,
      total: allTx.length,
      debug,
      insert_error: insertError,
    })
  } catch (e) {
    return respond(500, { error: String(e) })
  }
})
