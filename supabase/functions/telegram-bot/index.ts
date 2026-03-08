import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Published app URL for public payout links
const APP_URL = 'https://eshua1988.github.io/church-account-bliss-2cbd5be2';

// Session timeout: 1 hour in milliseconds
const SESSION_TIMEOUT_MS = 60 * 60 * 1000;

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
}

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
}

interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message: TelegramMessage;
  data: string;
}

interface UserSession {
  step: 'idle' | 'filling_amount' | 'filling_currency' | 'filling_category' | 'filling_issued_to' | 'filling_description' | 'confirm';
  linkId?: string;
  linkName?: string;
  ownerId?: string;
  registeredName?: string;
  lastActivity: number;
  data: {
    amount?: number;
    currency?: string;
    categoryId?: string;
    issuedTo?: string;
    description?: string;
    submitterName?: string;
  };
}

const CURRENCIES = ['PLN', 'EUR', 'USD'];

const sessions: Map<number, UserSession> = new Map();

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(chatId);
      console.log(`Session expired for chat ${chatId}`);
    }
  }
}

function getSession(chatId: number): UserSession | null {
  cleanExpiredSessions();
  const session = sessions.get(chatId);
  if (session) {
    session.lastActivity = Date.now();
  }
  return session || null;
}

function setSession(chatId: number, session: UserSession) {
  session.lastActivity = Date.now();
  sessions.set(chatId, session);
}

// Get bot token for a specific chat (user's own bot or shared)
async function getBotToken(chatId: number, supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supabase
    .from('telegram_users')
    .select('bot_token')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  
  return data?.bot_token || TELEGRAM_BOT_TOKEN;
}

async function getRegisteredName(chatId: number, supabase: ReturnType<typeof createClient>): Promise<string | null> {
  const { data } = await supabase
    .from('telegram_users')
    .select('registered_name')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  return data?.registered_name || null;
}

async function setRegisteredName(chatId: number, name: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('telegram_users')
    .update({ registered_name: name })
    .eq('telegram_chat_id', chatId)
    .select();
  
  return data && data.length > 0;
}

async function autoLinkTelegramUser(chatId: number, userId: string, name: string, username: string | undefined, supabase: ReturnType<typeof createClient>, botToken?: string) {
  const { data: existing } = await supabase
    .from('telegram_users')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  
  if (existing) {
    await supabase
      .from('telegram_users')
      .update({ user_id: userId, registered_name: name, is_active: true, telegram_username: username || null, last_activity: new Date().toISOString(), bot_token: botToken || null })
      .eq('telegram_chat_id', chatId);
  } else {
    const { data: userBots } = await supabase
      .from('telegram_users')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true);
    
    if (userBots && userBots.length >= 3) {
      return { success: false, reason: 'limit' };
    }
    
    const { error } = await supabase
      .from('telegram_users')
      .insert({
        telegram_chat_id: chatId,
        user_id: userId,
        registered_name: name,
        is_active: true,
        telegram_username: username || null,
        last_activity: new Date().toISOString(),
        bot_token: botToken || null,
      });
    
    if (error) {
      console.error('Error auto-linking telegram user:', error);
      return { success: false, reason: 'error' };
    }
  }
  
  return { success: true };
}

// Telegram API helpers - use token parameter
async function sendDocument(chatId: number, pdfBase64: string, fileName: string, caption: string, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;

  // Convert base64 to Uint8Array
  const binaryStr = atob(pdfBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }

  const formData = new FormData();
  formData.append('chat_id', String(chatId));
  formData.append('caption', caption);
  formData.append('document', new Blob([bytes], { type: 'application/pdf' }), fileName);

  const response = await fetch(url, { method: 'POST', body: formData });
  const result = await response.json();
  console.log('sendDocument result:', result);
  return result;
}

async function sendMessage(chatId: number, text: string, replyMarkup?: object, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  const result = await response.json();
  console.log('sendMessage result:', result);
  return result;
}

async function editMessageReplyMarkup(chatId: number, messageId: number, replyMarkup?: object, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/editMessageReplyMarkup`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  } else {
    body.reply_markup = { inline_keyboard: [] };
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function editMessageText(chatId: number, messageId: number, text: string, replyMarkup?: object, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function answerCallbackQuery(callbackQueryId: string, text?: string, token?: string) {
  const botToken = token || TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
}

async function getLinkedUser(chatId: number, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('telegram_users')
    .select('user_id, is_active, last_activity')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .maybeSingle();
  
  if (!data) return null;
  
  if (data.last_activity) {
    const lastActivity = new Date(data.last_activity).getTime();
    const now = Date.now();
    if (now - lastActivity > SESSION_TIMEOUT_MS) {
      await supabase
        .from('telegram_users')
        .update({ is_active: false })
        .eq('telegram_chat_id', chatId);
      return null;
    }
  }
  
  await supabase
    .from('telegram_users')
    .update({ last_activity: new Date().toISOString() })
    .eq('telegram_chat_id', chatId);
  
  return data;
}

async function getSharedLinks(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('shared_payout_links')
    .select('id, name, token, link_type, is_active')
    .eq('owner_user_id', userId)
    .eq('is_active', true);
  
  return data || [];
}

async function getCategories(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
    .eq('type', 'expense')
    .order('sort_order');
  
  return data || [];
}

async function getExpensesByDepartment(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
    .eq('type', 'expense');
  
  const { data: transactions } = await supabase
    .from('transactions')
    .select('amount, currency, category_id')
    .eq('user_id', userId)
    .eq('type', 'expense');
  
  if (!categories || !transactions) return [];
  
  const result: Record<string, Record<string, number>> = {};
  
  for (const cat of categories) {
    result[cat.name] = {};
  }
  
  for (const tx of transactions) {
    const category = categories.find(c => c.id === tx.category_id);
    if (category) {
      const catName = category.name;
      if (!result[catName][tx.currency]) {
        result[catName][tx.currency] = 0;
      }
      result[catName][tx.currency] += Number(tx.amount);
    }
  }
  
  return Object.entries(result).map(([name, amounts]) => ({
    name,
    amounts: Object.entries(amounts).map(([currency, total]) => `${total.toLocaleString()} ${currency}`).join(', ') || '0',
  }));
}

async function createTransaction(ownerId: string, data: UserSession['data'], supabase: ReturnType<typeof createClient>) {
  const { data: txData, error } = await supabase
    .from('transactions')
    .insert({
      user_id: ownerId,
      type: 'expense',
      amount: data.amount,
      currency: data.currency || 'PLN',
      category_id: data.categoryId || null,
      description: data.description || null,
      date: new Date().toISOString().split('T')[0],
      issued_to: data.issuedTo || null,
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('Error creating transaction:', error);
    return null;
  }
  
  return txData;
}

// Try to redeem a link code (6-digit code from the app)
async function tryRedeemLinkCode(chatId: number, code: string, username: string | undefined, supabase: ReturnType<typeof createClient>): Promise<{ redeemed: boolean; message?: string }> {
  // Look up unused, non-expired code (using service role, bypasses RLS)
  const { data: linkCode } = await supabase
    .from('telegram_link_codes')
    .select('id, user_id, bot_token, expires_at, used')
    .eq('code', code.toUpperCase())
    .eq('used', false)
    .maybeSingle();
  
  if (!linkCode) return { redeemed: false };
  
  // Check expiry
  if (new Date(linkCode.expires_at) < new Date()) {
    await supabase.from('telegram_link_codes').update({ used: true }).eq('id', linkCode.id);
    return { redeemed: true, message: '❌ Код истёк. Сгенерируйте новый в приложении.' };
  }
  
  // Get user's display name from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', linkCode.user_id)
    .maybeSingle();
  
  const displayName = profile?.display_name || 'Пользователь';
  
  // Link this chat to the user
  const linkResult = await autoLinkTelegramUser(chatId, linkCode.user_id, displayName, username, supabase, linkCode.bot_token || undefined);
  
  if (!linkResult.success) {
    if (linkResult.reason === 'limit') {
      return { redeemed: true, message: '❌ Достигнут лимит подключений (максимум 3).' };
    }
    return { redeemed: true, message: '❌ Ошибка привязки. Попробуйте позже.' };
  }
  
  // Mark code as used
  await supabase.from('telegram_link_codes').update({ used: true }).eq('id', linkCode.id);
  
  // Set session
  setSession(chatId, { step: 'idle', lastActivity: Date.now(), data: { submitterName: displayName }, registeredName: displayName });
  
  return { redeemed: true, message: `✅ Аккаунт привязан! Добро пожаловать, <b>${displayName}</b>!` };
}

function getMainMenu() {
  return {
    inline_keyboard: [
      [{ text: '📝 Заполнить документ', callback_data: 'fill_document' }],
      [{ text: '🔗 Выбрать ссылку для заполнения', callback_data: 'select_link' }],
      [{ text: '📊 Расходы по отделам', callback_data: 'expenses_by_dept' }],
      [{ text: '📷 Незаконченная сессия', callback_data: 'unfinished_session' }],
      [{ text: '❌ Закрыть меню', callback_data: 'close_menu' }],
    ],
  };
}

function getCollapsedMenu() {
  return {
    inline_keyboard: [
      [{ text: '📋 Открыть меню', callback_data: 'open_menu' }],
    ],
  };
}

async function handleMessage(message: TelegramMessage, supabase: ReturnType<typeof createClient>) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = message.text?.trim() || '';
  
  if (chatType !== 'private') {
    console.log(`Ignoring message from ${chatType} chat ${chatId}`);
    return;
  }
  
  // Get per-user bot token for replies
  const botToken = await getBotToken(chatId, supabase);
  
  const session = getSession(chatId);
  
  console.log(`Message from ${chatId}: ${text}, session step: ${session?.step}`);
  
  // Check if text looks like a 6-digit link code (before other handlers)
  if (/^[A-Z0-9]{6}$/i.test(text) && !session?.step?.startsWith('filling_')) {
    const result = await tryRedeemLinkCode(chatId, text, message.from.username, supabase);
    if (result.redeemed) {
      if (result.message?.startsWith('✅')) {
        await sendMessage(chatId, result.message, getMainMenu(), botToken);
      } else {
        await sendMessage(chatId, result.message || '❌ Ошибка', undefined, botToken);
      }
      return;
    }
    // If not a valid code, fall through to other handlers
  }
  
  // Handle /start
  if (text === '/start') {
    const linkedUser = await getLinkedUser(chatId, supabase);
    if (linkedUser) {
      const name = await getRegisteredName(chatId, supabase) || '';
      setSession(chatId, { step: 'idle', lastActivity: Date.now(), data: { submitterName: name } });
      await sendMessage(
        chatId,
        `👋 ${name ? name + ', в' : 'В'}ыберите действие:`,
        getMainMenu(),
        botToken
      );
    } else {
      setSession(chatId, { step: 'idle', lastActivity: Date.now(), data: {} });
      await sendMessage(
        chatId,
        '👋 Добро пожаловать!\n\nДля начала работы введите <b>6-значный код</b> из приложения (раздел «Настройки → Telegram»).',
        undefined,
        botToken
      );
    }
    return;
  }
  
  // Handle /menu
  if (text === '/menu') {
    const linkedUser = await getLinkedUser(chatId, supabase);
    if (!linkedUser) {
      await sendMessage(chatId, '❌ Аккаунт не привязан. Отправьте /start и введите 6-значный код из приложения (раздел «Настройки → Telegram»).', undefined, botToken);
      return;
    }
    const name = await getRegisteredName(chatId, supabase) || '';
    await sendMessage(
      chatId,
      `👋 ${name ? name + ', в' : 'В'}ыберите действие:`,
      getMainMenu(),
      botToken
    );
    return;
  }
  

  
  // Handle session-based input for document filling
  if (session) {
    switch (session.step) {
      case 'filling_amount': {
        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          await sendMessage(chatId, '❌ Введите корректную сумму (число больше 0)', undefined, botToken);
          return;
        }
        session.data.amount = amount;
        session.step = 'filling_currency';
        setSession(chatId, session);
        
        await sendMessage(chatId, '💱 Выберите валюту:', {
          inline_keyboard: CURRENCIES.map(c => [{ text: c, callback_data: `currency_${c}` }]),
        }, botToken);
        return;
      }
        
      case 'filling_issued_to':
        session.data.issuedTo = text;
        session.step = 'filling_description';
        setSession(chatId, session);
        await sendMessage(chatId, '📝 Введите описание (или /skip чтобы пропустить):', undefined, botToken);
        return;
        
      case 'filling_description':
        if (text !== '/skip') {
          session.data.description = text;
        }
        session.step = 'confirm';
        setSession(chatId, session);
        
        const summary = `
📋 <b>Проверьте данные:</b>

💰 Сумма: ${session.data.amount} ${session.data.currency}
👤 Кому: ${session.data.issuedTo || 'Не указано'}
📝 Описание: ${session.data.description || 'Нет'}
`;
        await sendMessage(chatId, summary, {
          inline_keyboard: [
            [{ text: '✅ Подтвердить', callback_data: 'confirm_document' }],
            [{ text: '❌ Отменить', callback_data: 'cancel_document' }],
          ],
        }, botToken);
        return;
    }
  }
  
  // For unrecognized text
  const linkedUser = await getLinkedUser(chatId, supabase);
  if (linkedUser) {
    await sendMessage(chatId, 'Используйте /menu для вызова главного меню', getMainMenu(), botToken);
  } else {
    await sendMessage(chatId, 'Используйте /start для регистрации или введите 6-значный код из приложения', undefined, botToken);
  }
}

async function handleCallbackQuery(query: CallbackQuery, supabase: ReturnType<typeof createClient>) {
  const chatId = query.message.chat.id;
  const chatType = query.message.chat.type;
  const data = query.data;
  
  if (chatType !== 'private') {
    console.log(`Ignoring callback from ${chatType} chat ${chatId}`);
    return;
  }
  
  const botToken = await getBotToken(chatId, supabase);
  const session = getSession(chatId) || { step: 'idle' as const, lastActivity: Date.now(), data: {} };
  
  console.log(`Callback from ${chatId}: ${data}`);
  
  await answerCallbackQuery(query.id, undefined, botToken);
  
  // Handle close/open menu
  if (data === 'close_menu') {
    await editMessageReplyMarkup(chatId, query.message.message_id, getCollapsedMenu(), botToken);
    return;
  }
  if (data === 'open_menu') {
    const name = await getRegisteredName(chatId, supabase) || '';
    await editMessageText(chatId, query.message.message_id, `${name ? name + ', в' : 'В'}ыберите действие:`, getMainMenu(), botToken);
    return;
  }
  if (data === 'back_to_menu') {
    const name = await getRegisteredName(chatId, supabase) || '';
    await editMessageText(chatId, query.message.message_id, `${name ? name + ', в' : 'В'}ыберите действие:`, getMainMenu(), botToken);
    return;
  }
  
  // Check if user is linked
  const linkedUser = await getLinkedUser(chatId, supabase);
  if (!linkedUser) {
    await sendMessage(chatId, '❌ Вы не зарегистрированы. Отправьте /start и введите Имя и Фамилию.', undefined, botToken);
    return;
  }
  
  const registeredName = await getRegisteredName(chatId, supabase) || session.registeredName;
  
  // Select link for filling
  if (data === 'select_link') {
    const links = await getSharedLinks(linkedUser.user_id, supabase);
    if (links.length === 0) {
      await editMessageText(chatId, query.message.message_id,
        '❌ Нет активных публичных ссылок.\n\nСоздайте ссылку в приложении через раздел «Публичные ссылки».',
        { inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]] },
        botToken
      );
      return;
    }
    await editMessageText(chatId, query.message.message_id, '🔗 <b>Выберите форму для заполнения:</b>', {
      inline_keyboard: [
        ...links.map(link => [{ text: `📄 ${link.name || 'Форма'}`, url: `${APP_URL}/payout/${link.token}` }]),
        [{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }],
      ],
    }, botToken);
    return;
  }
  
  // Fill document directly
  if (data === 'fill_document') {
    session.step = 'filling_amount';
    session.ownerId = linkedUser.user_id;
    session.data.submitterName = registeredName || query.from.first_name;
    setSession(chatId, session);
    
    await sendMessage(chatId, '📝 Заполнение документа\n\n💰 Введите сумму:', undefined, botToken);
    return;
  }
  
  // Currency selected
  if (data.startsWith('currency_')) {
    const currency = data.replace('currency_', '');
    session.data.currency = currency;
    
    const categories = await getCategories(session.ownerId || linkedUser.user_id, supabase);
    
    if (categories.length > 0) {
      session.step = 'filling_category';
      setSession(chatId, session);
      
      await sendMessage(chatId, '📁 Выберите категорию (отдел):', {
        inline_keyboard: [
          ...categories.map(cat => [{ text: cat.name, callback_data: `category_${cat.id}` }]),
          [{ text: '➡️ Пропустить', callback_data: 'category_skip' }],
        ],
      }, botToken);
    } else {
      session.step = 'filling_issued_to';
      setSession(chatId, session);
      await sendMessage(chatId, '👤 Введите кому выдано:', undefined, botToken);
    }
    return;
  }
  
  // Category selected
  if (data.startsWith('category_')) {
    if (data !== 'category_skip') {
      session.data.categoryId = data.replace('category_', '');
    }
    session.step = 'filling_issued_to';
    setSession(chatId, session);
    await sendMessage(chatId, '👤 Введите кому выдано:', undefined, botToken);
    return;
  }
  
  // Confirm document
  if (data === 'confirm_document') {
    const ownerId = session.ownerId || linkedUser.user_id;
    const tx = await createTransaction(ownerId, session.data, supabase);
    if (tx) {
      // Try to generate and send PDF
      try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const generateUrl = `${supabaseUrl}/functions/v1/generate-payout-pdf`;
        const pdfRes = await fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': Deno.env.get('SUPABASE_ANON_KEY') || '' },
          body: JSON.stringify({ transactionId: tx.id, ownerUserId: ownerId }),
        });

        if (pdfRes.ok) {
          const pdfData = await pdfRes.json();
          if (pdfData.pdfBase64 && pdfData.fileName) {
            await sendDocument(
              chatId,
              pdfData.pdfBase64,
              pdfData.fileName,
              `✅ Документ сохранён!\n📄 ${pdfData.fileName}`,
              botToken
            );
          } else {
            await sendMessage(chatId, '✅ Документ успешно сохранён!', undefined, botToken);
          }
        } else {
          await sendMessage(chatId, '✅ Документ успешно сохранён!', undefined, botToken);
        }
      } catch (pdfErr) {
        console.error('PDF generation error:', pdfErr);
        await sendMessage(chatId, '✅ Документ успешно сохранён!', undefined, botToken);
      }

      await sendMessage(chatId, '📋 Главное меню:', getMainMenu(), botToken);

      await supabase
        .from('payout_image_tracking')
        .insert({
          owner_user_id: ownerId,
          transaction_id: tx.id,
          submitter_name: session.data.submitterName || 'Telegram',
          telegram_chat_id: chatId,
        });
    } else {
      await sendMessage(chatId, '❌ Ошибка при сохранении документа', undefined, botToken);
    }
    session.step = 'idle';
    setSession(chatId, session);
    return;
  }
  
  // Cancel document
  if (data === 'cancel_document') {
    session.step = 'idle';
    setSession(chatId, session);
    await sendMessage(chatId, '❌ Отменено', getMainMenu(), botToken);
    return;
  }
  
  // Expenses by department
  if (data === 'expenses_by_dept') {
    const expenses = await getExpensesByDepartment(linkedUser.user_id, supabase);
    if (expenses.length === 0) {
      await editMessageText(chatId, query.message.message_id, '📊 Нет данных о расходах', {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]],
      }, botToken);
      return;
    }
    
    let text = '📊 <b>Расходы по отделам:</b>\n\n';
    for (const exp of expenses) {
      text += `📁 ${exp.name}: ${exp.amounts || '0'}\n`;
    }
    
    await editMessageText(chatId, query.message.message_id, text, {
      inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]],
    }, botToken);
    return;
  }
  
  // Unfinished session
  if (data === 'unfinished_session') {
    const userName = registeredName || '';
    if (!userName) {
      await editMessageText(chatId, query.message.message_id, '❌ Имя не найдено. Отправьте /start и введите Имя и Фамилию.', {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]],
      }, botToken);
      return;
    }

    const { data: trackingRecords } = await supabase
      .from('payout_image_tracking')
      .select('transaction_id, submitter_name')
      .eq('owner_user_id', linkedUser.user_id)
      .order('skipped_at', { ascending: false })
      .limit(20);

    const userNameLower = userName.toLowerCase().trim();
    const userNameParts = userNameLower.split(/\s+/);
    
    const userTracking = (trackingRecords || []).filter(r => {
      const submitter = (r.submitter_name || '').toLowerCase().trim();
      return userNameParts.every(part => submitter.includes(part)) || 
             submitter.split(/\s+/).every((part: string) => userNameLower.includes(part));
    });

    const trackingTxIds = userTracking
      .map(r => r.transaction_id)
      .filter((id): id is string => id !== null);

    const searchPattern = `%[Bez załączników%]%`;
    const { data: pendingTx } = await supabase
      .from('transactions')
      .select('id, amount, currency, description, date, category_id, issued_to')
      .eq('user_id', linkedUser.user_id)
      .eq('type', 'expense')
      .like('description', searchPattern)
      .order('created_at', { ascending: false })
      .limit(50);

    const filteredTx = (pendingTx || []).filter(tx => {
      if (trackingTxIds.includes(tx.id)) return true;
      if (tx.issued_to) {
        const issuedLower = tx.issued_to.toLowerCase().trim();
        return userNameParts.every(part => issuedLower.includes(part)) ||
               issuedLower.split(/\s+/).every((part: string) => userNameLower.includes(part));
      }
      return false;
    });

    if (filteredTx.length === 0) {
      await editMessageText(chatId, query.message.message_id, '✅ У вас нет незаконченных сессий (все фото добавлены).', {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]],
      }, botToken);
      return;
    }

    const links = await getSharedLinks(linkedUser.user_id, supabase);
    const activeLink = links.length > 0 ? links[0] : null;

    if (!activeLink) {
      await editMessageText(chatId, query.message.message_id, '❌ Нет активных ссылок. Создайте ссылку в приложении.', {
        inline_keyboard: [[{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]],
      }, botToken);
      return;
    }

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', linkedUser.user_id);

    let text = '📷 <b>Незаконченная сессия — документы без фото:</b>\n\n';
    const buttons: Array<Array<{text: string, url?: string, callback_data?: string}>> = [];

    for (const tx of filteredTx) {
      const catName = categories?.find(c => c.id === tx.category_id)?.name || '';
      const dateStr = new Date(tx.date).toLocaleDateString('ru-RU');
      const currencySymbol = tx.currency === 'EUR' ? '€' : tx.currency === 'USD' ? '$' : tx.currency;
      const recipient = tx.issued_to || '';
      text += `📄 ${catName ? catName + ' — ' : ''}${Number(tx.amount).toLocaleString()} ${currencySymbol}${recipient ? '\n👤 ' + recipient : ''}\n📅 ${dateStr}\n\n`;
      
      const payoutUrl = `${APP_URL}/payout/${activeLink.token}`;
      buttons.push([{ text: `📎 ${recipient || catName || 'Документ'} — ${Number(tx.amount).toLocaleString()} ${currencySymbol}`, url: payoutUrl }]);
    }

    text += 'Нажмите на документ, чтобы добавить фото:';
    buttons.push([{ text: '◀️ Назад в меню', callback_data: 'back_to_menu' }]);

    await editMessageText(chatId, query.message.message_id, text, { inline_keyboard: buttons }, botToken);
    return;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  const url = new URL(req.url);
  
  // Setup webhook for shared bot
  if (url.searchParams.get('setup') === 'true') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-bot`;
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    
    console.log('Setting webhook URL:', webhookUrl);
    
    const response = await fetch(telegramUrl);
    const result = await response.json();
    
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: 'Регистрация / перезапуск' },
          { command: 'menu', description: 'Открыть главное меню' },
        ],
      }),
    });
    
    console.log('Webhook setup result:', result);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  
  // Setup webhook for a custom bot token
  if (url.searchParams.get('setup_custom') === 'true') {
    try {
      const body = await req.json();
      const customToken = body.bot_token;
      
      if (!customToken) {
        return new Response(JSON.stringify({ ok: false, description: 'bot_token required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const webhookUrl = `${supabaseUrl}/functions/v1/telegram-bot`;
      
      // Verify token by calling getMe
      const getMeRes = await fetch(`https://api.telegram.org/bot${customToken}/getMe`);
      const getMeResult = await getMeRes.json();
      
      if (!getMeResult.ok) {
        return new Response(JSON.stringify({ ok: false, description: 'Недействительный токен бота' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      // Set webhook
      const whRes = await fetch(`https://api.telegram.org/bot${customToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`);
      const whResult = await whRes.json();
      
      // Set commands
      await fetch(`https://api.telegram.org/bot${customToken}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'start', description: 'Регистрация / перезапуск' },
            { command: 'menu', description: 'Открыть главное меню' },
          ],
        }),
      });
      
      return new Response(JSON.stringify({ ok: whResult.ok, bot: getMeResult.result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      console.error('Custom bot setup error:', error);
      return new Response(JSON.stringify({ ok: false, description: 'Server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  
  if (req.method === 'POST') {
    try {
      const update: TelegramUpdate = await req.json();
      console.log('Received update:', JSON.stringify(update));
      
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      
      if (update.message) {
        await handleMessage(update.message, supabase);
      } else if (update.callback_query) {
        await handleCallbackQuery(update.callback_query, supabase);
      }
      
      return new Response('ok', { headers: corsHeaders });
    } catch (error) {
      console.error('Error processing update:', error);
      return new Response('ok', { headers: corsHeaders });
    }
  }
  
  return new Response('Telegram Bot Webhook', { headers: corsHeaders });
});
