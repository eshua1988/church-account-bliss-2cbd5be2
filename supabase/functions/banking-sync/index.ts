const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

// A short lookback can permanently miss older operations when a sync was not
// run for several weeks. Keep a full year available for reconciliation.
const SYNC_LOOKBACK_DAYS = 365
const transactionKey = (transaction) => `${transaction.date}|${transaction.amount}|${transaction.type}|${transaction.currency}|${transaction.bank_title || transaction.description}`
const bankCreatedAt = (transaction) => {
  const exact = Date.parse(transaction.bank_sort_time || '')
  if (Number.isFinite(exact)) return new Date(exact).toISOString()
  const base = Date.parse(`${transaction.date}T23:59:59.000Z`)
  return new Date((Number.isFinite(base) ? base : Date.now()) - (transaction.bank_order || 0) * 1000).toISOString()
}

const bankDateParts = (tx, fallback) => {
  const rawDate = tx.booking_date || tx.value_date || fallback
  const rawTime = tx.booking_date_time || tx.booking_datetime || tx.transaction_date_time || tx.transaction_datetime
  const exact = rawTime || (rawDate && String(rawDate).includes('T') ? rawDate : '')
  const date = String(rawDate || fallback).slice(0, 10)
  return { date, exact: exact ? String(exact) : null }
}

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
    let totalExisting = 0
    let totalMissing = 0
    let totalExtra = 0
    const missingTransactions = []
    const extraTransactions = []
    const allSyncDebug = []

    for (const conn of connections) {
      const connBankName = conn.bank_name || 'PKO BP'
      const source = connBankName.toLowerCase().replace(/\s+/g, '_')
      let accounts = conn.accounts || []

      // If no accounts saved, try refreshing from the session
      if (accounts.length === 0 && conn.session_id) {
        try {
          const sessRes = await fetch(`https://api.enablebanking.com/sessions/${conn.session_id}`, {
            headers: ebHeaders,
          })
          if (sessRes.ok) {
            const sessData = await sessRes.json()
            accounts = sessData.accounts || []
            // Save refreshed accounts back to DB
            if (accounts.length > 0) {
              const accountsInfo = accounts.map(a => ({
                uid: a.uid,
                iban: a.account_id?.iban || a.iban || '',
                name: a.account_id?.iban || a.uid,
              }))
              await db.from('bank_connections').update({ accounts: accountsInfo })
                .eq('user_id', user_id).eq('bank_name', connBankName)
            }
          }
        } catch (e) {
          // ignore session refresh error
        }
      }

      if (accounts.length === 0) {
        allSyncDebug.push({ bank: connBankName, error: 'Нет счетов. Попробуйте переподключить банк.' })
        continue
      }

    // Fetch with a wider overlap so late-booked bank operations are not skipped
    // if last_sync_at was moved forward by a previous zero-result sync.
    const dateFrom = conn.last_sync_at
      ? (() => {
          const d = new Date(conn.last_sync_at)
          d.setDate(d.getDate() - SYNC_LOOKBACK_DAYS)
          return d.toISOString().split('T')[0]
        })()
      : '2015-01-01'

    const allTx = []
    const syncDebug = []
    let accountFetchSuccesses = 0
    let missingForBank = []
    let extraForBank = []

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
        url.searchParams.set('strategy', 'longest')
        if (continuationKey) url.searchParams.set('continuation_key', continuationKey)

        const txRes = await fetch(url.toString(), { headers: ebHeaders })
        const txText = await txRes.text()
        let txData = {}
        try { txData = JSON.parse(txText) } catch {}

        if (!txRes.ok) {
          syncDebug.push({ uid, page: pageCount, status: txRes.status, error: txText.slice(0,200) })
          break
        }

        accountFetchSuccesses++

        const pageTxs = txData.transactions || []
        totalForAcc += pageTxs.length

        for (const tx of pageTxs) {
          const amount = parseFloat(tx.transaction_amount?.amount || tx.amount || '0')
          const debit = tx.credit_debit_indicator === 'DBIT' || amount < 0
          const rawBankTitle = Array.isArray(tx.remittance_information)
            ? tx.remittance_information.join(' ')
            : (tx.remittance_information || '')
          const bankTitle = String(rawBankTitle)
            .replace(/(?:\d{4}\s*)?OD:\s*\d+\s+DO:\s*\d+\s+MOBILE-PAYMENT-C2C\b/gi, ' ')
            .replace(/OD:\s*[\d*]+\s+DO:\s*[\d*]+(?=\s|$|[.,;])/gi, ' ')
            .replace(/\bPRZELEW\s+NA\s+TELEFON\s+[\d*]+\.?/gi, ' ')
            .replace(/\b\d{4}\s+\d{10,}\s+MOBILE-PAYMENT-ATM-TX-CODE\b/gi, ' ')
            .replace(/(^|\s)(?:TRANSFER[-_\s]?(?:IN|OUT)|MOBILE-PAYMENT-C2C-EXTERNAL)(?=\s|$)/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim()
          const bankSender = tx.debtor?.name || ''
          const bankRecipient = tx.creditor?.name || ''
          const bankDate = bankDateParts(tx, dateFrom)
          allTx.push({
            date: bankDate.date,
            bank_sort_time: bankDate.exact,
            amount: Math.abs(amount),
            currency: String(tx.transaction_amount?.currency || tx.currency || 'PLN').toUpperCase(),
            description: bankTitle || bankSender || bankRecipient || connBankName,
            type: debit ? 'expense' : 'income',
            external_id: tx.entry_reference || tx.transaction_id || null,
            bank_title: bankTitle || null,
            bank_sender: bankSender || null,
            bank_recipient: bankRecipient || null,
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
      // Use the bank's exact booking timestamp for the hidden sort order.
      allTx.sort((a, b) => {
        const aTime = Date.parse(a.bank_sort_time || `${a.date}T00:00:00Z`)
        const bTime = Date.parse(b.bank_sort_time || `${b.date}T00:00:00Z`)
        return bTime - aTime
      })
      const dayOrders = new Map()
      allTx.forEach(transaction => {
        if (!transaction.bank_sort_time) {
          const order = dayOrders.get(transaction.date) || 0
          transaction.bank_order = order
          dayOrders.set(transaction.date, order + 1)
        }
      })
      // Deduplicate by external_id
      const { data: existing } = await db.from('transactions')
        .select('id, external_id, date, amount, description, bank_title, bank_sender, bank_recipient, type, currency')
        .eq('user_id', user_id)
        .eq('source', source)
        .gte('date', dateFrom)
      const { data: existingWithExternalIds } = await db.from('transactions')
        .select('external_id')
        .eq('user_id', user_id)
        .not('external_id', 'is', null)
      const existingIds = new Set((existingWithExternalIds || []).map(r => r.external_id))
      totalExisting += (existing || []).length
      const matchedExisting = new Set()
      const matchedBankRows = []
      const existingKeys = new Map()
      ;(existing || []).forEach((row, index) => {
        const key = transactionKey(row)
        const indexes = existingKeys.get(key) || []
        indexes.push(index)
        existingKeys.set(key, indexes)
      })

      missingForBank = allTx.filter(t => {
        const externalIndex = t.external_id
          ? (existing || []).findIndex((row, index) => row.external_id === t.external_id && !matchedExisting.has(index))
          : -1
        if (externalIndex >= 0) {
          matchedExisting.add(externalIndex)
          matchedBankRows.push({ row: existing[externalIndex], transaction: t })
          return false
        }
        const indexes = existingKeys.get(transactionKey(t)) || []
        const matchIndex = indexes.find(index => !matchedExisting.has(index))
        if (matchIndex === undefined) return true
        matchedExisting.add(matchIndex)
        matchedBankRows.push({ row: existing[matchIndex], transaction: t })
        return false
      })
      await Promise.all(matchedBankRows
        .filter(match => match.row.id)
        .map(match => db.from('transactions')
          .update({ created_at: bankCreatedAt(match.transaction) })
          .eq('id', match.row.id)))
      totalMissing += missingForBank.length
      missingForBank.slice(0, 100).forEach(t => missingTransactions.push({
        bank: connBankName,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description: t.description,
      }))
      extraForBank = (existing || []).filter((_, index) => !matchedExisting.has(index))
      totalExtra += extraForBank.length
      extraForBank.slice(0, 100).forEach(t => extraTransactions.push({
        bank: connBankName,
        date: t.date,
        amount: t.amount,
        type: t.type,
        description: t.bank_title || t.description,
      }))

      // The reconciliation result is the authoritative import list. This
      // prevents a second deduplication pass from dropping the missing row.
      const seenExternalIds = new Set()
      const seenKeys = new Set()
      const newTx = missingForBank.filter(t => {
        if (t.external_id) {
          if (seenExternalIds.has(t.external_id)) return false
          seenExternalIds.add(t.external_id)
        }
        const key = transactionKey(t)
        if (seenKeys.has(key)) return false
        seenKeys.add(key)
        return true
      })

      if (newTx.length > 0) {
        // Find default income category
        const { data: incomeCats } = await db.from('categories')
          .select('id')
          .eq('user_id', user_id)
          .eq('type', 'income')
          .order('sort_order', { ascending: true })
          .limit(1)
        const defaultIncomeCatId = incomeCats?.[0]?.id || null

        // Detect "Целевые пожертвования" — income with a 2-digit number in bank_title
        // Patterns: "37 oleksandr", "37oleksandr", "PRZELEW NA TELEFON 48666***427. 37oleksandr"
        const targetedDonationRegex = /(?:^|\.\s*)\d{2}(?:\s|\D)/i

        const insertedTx = []
        for (const [index, t] of newTx.entries()) {
          const isTargetedDonation = t.type === 'income' && t.bank_title && targetedDonationRegex.test(t.bank_title)
          const transactionRow = {
            user_id,
            date: t.date,
            created_at: bankCreatedAt(t),
            amount: t.amount,
            currency: t.currency,
            description: t.description,
            type: t.type,
            category_id: t.type === 'income' ? defaultIncomeCatId : null,
            source,
            external_id: t.external_id || null,
            bank_title: t.bank_title || null,
            bank_sender: t.bank_sender || null,
            bank_recipient: t.bank_recipient || null,
            department_name: isTargetedDonation ? 'Целевые пожертвования' : null,
          }
          let { error } = await db.from('transactions').insert(transactionRow)
          if (error?.code === '23505' && t.external_id) {
            // The bank identifier can collide with an old/global row. Keep
            // the transaction instead of dropping it, but omit that identifier.
            const retryRow = { ...transactionRow, external_id: null }
            const retryResult = await db.from('transactions').insert(retryRow)
            error = retryResult.error
          }
          if (!error) {
            imported++
            insertedTx.push(t)
            continue
          }
          insertError = String(error.message)
        }

        if (insertedTx.length > 0) {

          // Apply department_rules to newly inserted transactions
          const { data: rules } = await db.from('department_rules').select('*').eq('user_id', user_id)
          if (rules && rules.length > 0) {
            for (const rule of rules) {
              // Find newly inserted transactions matching this rule
              const matchingTx = insertedTx.filter(t => {
                if (rule.transaction_type && rule.transaction_type !== t.type) return false
                const searchTerms = String(rule.search_text || '')
                  .split(',')
                  .map(term => term.trim().toLowerCase())
                  .filter(Boolean)
                const title = (t.bank_title || '').toLowerCase()
                const desc = (t.description || '').toLowerCase()
                return searchTerms.some(term => title.includes(term) || desc.includes(term))
              })
              if (matchingTx.length > 0) {
                const externalIds = matchingTx.map(t => t.external_id).filter(Boolean)
                if (externalIds.length > 0) {
                  await db.from('transactions')
                    .update({ department_name: rule.department_name })
                    .eq('user_id', user_id)
                    .in('external_id', externalIds)
                    .is('department_name', null)
                }
              }
            }
          }
        }
      }
    }

    if (accountFetchSuccesses > 0) {
      await db.from('bank_connections').update({
        last_sync_at: new Date().toISOString()
      }).eq('user_id', user_id).eq('bank_name', connBankName)
    }

    totalImported += imported
    totalTx += allTx.length
    allSyncDebug.push({
      bank: connBankName,
      imported,
      total: allTx.length,
      missing: missingForBank.length,
      extra: extraForBank.length,
      date_from: dateFrom,
      insert_error: insertError,
      fetch_successes: accountFetchSuccesses,
      debug: syncDebug,
    })
    } // end for each connection

    return respond(200, {
      imported: totalImported,
      total: totalTx,
      bank_total: totalTx,
      app_total: totalExisting,
      missing: Math.max(totalMissing - totalImported, 0),
      extra: totalExtra,
      missing_transactions: totalImported > 0 ? [] : missingTransactions,
      extra_transactions: extraTransactions,
      errors: allSyncDebug.filter(d => d.insert_error).map(d => d.insert_error),
      date_from: connections.map(c => c.last_sync_at ? new Date(c.last_sync_at).toISOString().split('T')[0] : '2020-01-01').join(', '),
      banks: connections.map(c => c.bank_name),
      debug: allSyncDebug,
    })
  } catch(e) {
    return respond(500, { error: String(e) })
  }
})
