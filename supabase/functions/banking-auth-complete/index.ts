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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json()
    const { code, user_id, bank_name } = body
    if (!code) return respond(400, { error: 'code обязателен' })
    if (!user_id) return respond(400, { error: 'user_id не передан — пользователь не авторизован' })
    const resolvedBankName = bank_name || 'PKO BP'

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
    let accounts = sessData.accounts || []

    // If POST /sessions returned no accounts, try GET /sessions/{id} as fallback
    if (accounts.length === 0 && sessionId) {
      try {
        const sessGetRes = await fetch(`https://api.enablebanking.com/sessions/${sessionId}`, {
          headers: ebHeaders
        })
        if (sessGetRes.ok) {
          const sessGetData = await sessGetRes.json()
          accounts = sessGetData.accounts || []
        }
      } catch (e) {
        // ignore fallback error
      }
    }

    const debug = {
      session_id: sessionId,
      accounts_count: accounts.length,
      accounts_uids: accounts.map(a => a.uid),
      raw_accounts: accounts,
    }

    // Save bank connection even if no accounts (connection is valid for future syncs)
    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)

      const accountsInfo = accounts.map(a => ({
        uid: a.uid,
        iban: a.account_id?.iban || a.iban || '',
        name: a.account_id?.iban || a.uid,
      }))
      const { error: upsertError } = await db.from('bank_connections').upsert({
        user_id,
        bank_name: resolvedBankName,
        session_id: sessionId,
        accounts: accountsInfo,
        connected_at: new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      }, { onConflict: 'user_id,bank_name' })
      if (upsertError) {
        console.error('[banking-auth-complete] upsert error:', upsertError)
        debug.upsert_error = upsertError.message
      }

      if (accounts.length === 0) {
        return respond(200, { imported: 0, total: 0, debug, note: 'Банк подключён, но счета пока недоступны. Попробуйте синхронизировать позже.' })
      }
    }

    // 2. Fetch transactions from each account (full history)
    const dateFrom = '2015-01-01'
    const allTx = []
    const txDebug = []

    for (const acc of accounts) {
      const uid = acc.uid
      if (!uid) continue
      const iban = acc.account_id?.iban || acc.iban || ''
      let pageCount = 0
      let continuationKey: string | null = null
      let totalForAcc = 0

      // Paginate through all pages using continuation_key
      do {
        const url = new URL(`https://api.enablebanking.com/accounts/${uid}/transactions`)
        url.searchParams.set('date_from', dateFrom)
        url.searchParams.set('transaction_status', 'BOOK')
        url.searchParams.set('strategy', 'longest')
        if (continuationKey) url.searchParams.set('continuation_key', continuationKey)

        const txRes = await fetch(url.toString(), { headers: ebHeaders })
        const txText = await txRes.text()
        let txData: any = {}
        try { txData = JSON.parse(txText) } catch {}

        if (!txRes.ok) {
          txDebug.push({ uid, page: pageCount, status: txRes.status, error: txText.slice(0,300) })
          break
        }

        const pageTxs = txData.transactions || []
        totalForAcc += pageTxs.length

        for (const tx of pageTxs) {
          const amount = parseFloat(tx.transaction_amount?.amount || tx.amount || '0')
          const debit = tx.credit_debit_indicator === 'DBIT' || amount < 0
          const bankTitle = Array.isArray(tx.remittance_information)
            ? tx.remittance_information.join(' ')
            : (tx.remittance_information || '')
          const bankSender = tx.debtor?.name || ''
          const bankRecipient = tx.creditor?.name || ''
          allTx.push({
            date: tx.booking_date || tx.value_date || dateFrom,
            amount: Math.abs(amount),
            description: bankTitle || bankSender || bankRecipient || resolvedBankName,
            type: debit ? 'expense' : 'income',
            source: resolvedBankName.toLowerCase().replace(/\s+/g, '_'),
            external_id: tx.entry_reference || tx.transaction_id || null,
            iban,
            bank_title: bankTitle || null,
            bank_sender: bankSender || null,
            bank_recipient: bankRecipient || null,
          })
        }

        continuationKey = txData.continuation_key || null
        pageCount++

        // Safety limit: max 100 pages (5000 transactions)
        if (pageCount >= 100) break
      } while (continuationKey)

      txDebug.push({ uid, pages: pageCount, total: totalForAcc })
    }

    debug.tx_debug = txDebug
    debug.total_txs = allTx.length

    // 3. Insert into Supabase (skip duplicates by external_id)
    let imported = 0
    let insertError = null

    if (supabaseUrl && supabaseKey) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
      const db = createClient(supabaseUrl, supabaseKey)

      if (allTx.length > 0) {
        // Get existing external_ids for this user to skip duplicates
        const { data: existing } = await db.from('transactions')
          .select('external_id')
          .eq('user_id', user_id)
          .not('external_id','is',null)
        const existingIds = new Set((existing||[]).map(r => r.external_id))

        const newTx = allTx.filter(t => !t.external_id || !existingIds.has(t.external_id))

        if (newTx.length > 0) {
          // Find default income category
          const { data: incomeCats } = await db.from('categories')
            .select('id')
            .eq('user_id', user_id)
            .eq('type', 'income')
            .order('sort_order', { ascending: true })
            .limit(1)
          const defaultIncomeCatId = incomeCats?.[0]?.id || null

          const { error } = await db.from('transactions').insert(
            newTx.map(t => ({
              user_id,
              date: t.date,
              amount: t.amount,
              description: t.description,
              type: t.type,
              category_id: t.type === 'income' ? defaultIncomeCatId : null,
              source: resolvedBankName.toLowerCase().replace(/\s+/g, '_'),
              external_id: t.external_id || null,
              bank_title: t.bank_title || null,
              bank_sender: t.bank_sender || null,
              bank_recipient: t.bank_recipient || null,
            }))
          )
          insertError = error ? String(error.message) : null
          if (!error) {
            imported = newTx.length

            const { data: rules } = await db.from('department_rules').select('*').eq('user_id', user_id)
            if (rules && rules.length > 0) {
              for (const rule of rules) {
                const matchingTx = newTx.filter(t => {
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
