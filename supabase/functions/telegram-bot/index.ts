import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Published app URL for public payout links
const APP_URL = 'https://church-account-bliss.lovable.app';

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
  step: 'awaiting_name' | 'idle' | 'filling_amount' | 'filling_currency' | 'filling_category' | 'filling_issued_to' | 'filling_description' | 'confirm';
  linkId?: string;
  linkName?: string;
  ownerId?: string;
  registeredName?: string;
  lastActivity: number; // timestamp ms
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

// Clean up expired sessions (older than 1 hour)
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [chatId, session] of sessions) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(chatId);
      console.log(`Session expired for chat ${chatId}`);
    }
  }
}

// Get or refresh session (returns null if expired)
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

// Try to find a user in profiles by display_name matching the entered name
async function findUserByName(name: string, supabase: ReturnType<typeof createClient>) {
  const nameLower = name.toLowerCase().trim();
  
  // Search profiles by display_name (case-insensitive)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, display_name')
    .ilike('display_name', `%${nameLower}%`);
  
  if (!profiles || profiles.length === 0) return null;
  
  // Try exact match first
  const exact = profiles.find(p => p.display_name?.toLowerCase().trim() === nameLower);
  if (exact) return exact;
  
  // If only one partial match, use it
  if (profiles.length === 1) return profiles[0];
  
  return null;
}

// Auto-register telegram user by linking to found profile
async function autoLinkTelegramUser(chatId: number, userId: string, name: string, username: string | undefined, supabase: ReturnType<typeof createClient>) {
  // Check if this chat_id already has a record
  const { data: existing } = await supabase
    .from('telegram_users')
    .select('id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();
  
  if (existing) {
    // Update existing record — reactivate and refresh
    await supabase
      .from('telegram_users')
      .update({ user_id: userId, registered_name: name, is_active: true, telegram_username: username || null, last_activity: new Date().toISOString() })
      .eq('telegram_chat_id', chatId);
  } else {
    // Check how many telegram accounts this user already has
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
      });
    
    if (error) {
      console.error('Error auto-linking telegram user:', error);
      return { success: false, reason: 'error' };
    }
  }
  
  return { success: true };
}

async function sendMessage(chatId: number, text: string, replyMarkup?: object) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
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

async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`;
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
  
  // Check if session expired (1 hour of inactivity)
  if (data.last_activity) {
    const lastActivity = new Date(data.last_activity).getTime();
    const now = Date.now();
    if (now - lastActivity > SESSION_TIMEOUT_MS) {
      // Session expired — deactivate link, user must re-register via /start
      await supabase
        .from('telegram_users')
        .update({ is_active: false })
        .eq('telegram_chat_id', chatId);
      return null;
    }
  }
  
  // Update last_activity timestamp
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

function getMainMenu() {
  return {
    inline_keyboard: [
      [{ text: '📝 Заполнить документ', callback_data: 'fill_document' }],
      [{ text: '🔗 Выбрать ссылку для заполнения', callback_data: 'select_link' }],
      [{ text: '📊 Расходы по отделам', callback_data: 'expenses_by_dept' }],
      [{ text: '📷 Незаконченная сессия', callback_data: 'unfinished_session' }],
    ],
  };
}

async function handleMessage(message: TelegramMessage, supabase: ReturnType<typeof createClient>) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = message.text?.trim() || '';
  
  // Only respond in private chats
  if (chatType !== 'private') {
    console.log(`Ignoring message from ${chatType} chat ${chatId}`);
    return;
  }
  
  const session = getSession(chatId);
  
  console.log(`Message from ${chatId}: ${text}, session step: ${session?.step}`);
  
  // Handle /start — always ask for name registration
  if (text === '/start') {
    setSession(chatId, { step: 'awaiting_name', lastActivity: Date.now(), data: {} });
    await sendMessage(
      chatId,
      '👋 Добро пожаловать!\n\nДля начала работы введите ваше <b>Имя и Фамилию</b>:'
    );
    return;
  }
  
  // Handle /menu
  if (text === '/menu') {
    const linkedUser = await getLinkedUser(chatId, supabase);
    if (!linkedUser) {
      await sendMessage(chatId, '❌ Вы не зарегистрированы. Отправьте /start и введите Имя и Фамилию.');
      return;
    }
    const name = await getRegisteredName(chatId, supabase) || '';
    await sendMessage(
      chatId,
      `👋 ${name ? name + ', в' : 'В'}ыберите действие:`,
      getMainMenu()
    );
    return;
  }
  
  // Handle name registration step
  const isAwaitingName = session?.step === 'awaiting_name';
  
  if (isAwaitingName) {
    const nameParts = text.split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) {
      await sendMessage(chatId, '❌ Пожалуйста, введите <b>Имя и Фамилию</b> через пробел:');
      return;
    }
    
    const fullName = nameParts.join(' ');
    
    // Try to find user in profiles by name
    const foundUser = await findUserByName(fullName, supabase);
    
    if (!foundUser) {
      await sendMessage(
        chatId,
        `❌ Пользователь с именем <b>${fullName}</b> не найден в системе.\n\nПроверьте правильность написания и попробуйте снова.\nИмя должно совпадать с именем в приложении.`
      );
      return;
    }
    
    // Auto-link this telegram chat to the found user
    const linkResult = await autoLinkTelegramUser(chatId, foundUser.user_id, fullName, message.from.username, supabase);
    
    if (!linkResult.success) {
      if (linkResult.reason === 'limit') {
        await sendMessage(chatId, '❌ Достигнут лимит подключений (максимум 3 Telegram-аккаунта на пользователя).');
      } else {
        await sendMessage(chatId, '❌ Ошибка при регистрации. Попробуйте позже.');
      }
      return;
    }
    
    // Update session
    setSession(chatId, { step: 'idle', lastActivity: Date.now(), data: { submitterName: fullName }, registeredName: fullName });
    
    await sendMessage(
      chatId,
      `✅ Добро пожаловать, <b>${fullName}</b>!\n\nВы успешно зарегистрированы. Выберите действие:`,
      getMainMenu()
    );
    return;
  }
  
  // Handle session-based input for document filling
  if (session) {
    switch (session.step) {
      case 'filling_amount': {
        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          await sendMessage(chatId, '❌ Введите корректную сумму (число больше 0)');
          return;
        }
        session.data.amount = amount;
        session.step = 'filling_currency';
        setSession(chatId, session);
        
        await sendMessage(chatId, '💱 Выберите валюту:', {
          inline_keyboard: CURRENCIES.map(c => [{ text: c, callback_data: `currency_${c}` }]),
        });
        return;
      }
        
      case 'filling_issued_to':
        session.data.issuedTo = text;
        session.step = 'filling_description';
        setSession(chatId, session);
        await sendMessage(chatId, '📝 Введите описание (или /skip чтобы пропустить):');
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
        });
        return;
    }
  }
  
  // For unrecognized text — check if linked, suggest /start or /menu
  const linkedUser = await getLinkedUser(chatId, supabase);
  if (linkedUser) {
    await sendMessage(chatId, 'Используйте /menu для вызова главного меню', getMainMenu());
  } else {
    await sendMessage(chatId, 'Используйте /start для регистрации');
  }
}

async function handleCallbackQuery(query: CallbackQuery, supabase: ReturnType<typeof createClient>) {
  const chatId = query.message.chat.id;
  const chatType = query.message.chat.type;
  const data = query.data;
  
  // Only respond in private chats
  if (chatType !== 'private') {
    console.log(`Ignoring callback from ${chatType} chat ${chatId}`);
    return;
  }
  
  const session = getSession(chatId) || { step: 'idle' as const, lastActivity: Date.now(), data: {} };
  
  console.log(`Callback from ${chatId}: ${data}`);
  
  await answerCallbackQuery(query.id);
  
  // Check if user is linked
  const linkedUser = await getLinkedUser(chatId, supabase);
  if (!linkedUser) {
    await sendMessage(chatId, '❌ Вы не зарегистрированы. Отправьте /start и введите Имя и Фамилию.');
    return;
  }
  
  const registeredName = await getRegisteredName(chatId, supabase) || session.registeredName;
  
  // Select link for filling — show two fixed links
  if (data === 'select_link') {
    await sendMessage(chatId, '🔗 Выберите ссылку для заполнения:', {
      inline_keyboard: [
        [{ text: '📄 Standard форма', url: `${APP_URL}/payout/iHEMNKO3cnuD5909l7wxM8b1qnAq7t2f` }],
        [{ text: '📋 Stepwise форма', url: `${APP_URL}/payout/acfa2b276b11cb2dba1a17919831e2a582398b39832ea381f38834ba8d8cee50` }],
      ],
    });
    return;
  }
  
  // Fill document directly
  if (data === 'fill_document') {
    session.step = 'filling_amount';
    session.ownerId = linkedUser.user_id;
    session.data.submitterName = registeredName || query.from.first_name;
    setSession(chatId, session);
    
    await sendMessage(chatId, '📝 Заполнение документа\n\n💰 Введите сумму:');
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
      });
    } else {
      session.step = 'filling_issued_to';
      setSession(chatId, session);
      await sendMessage(chatId, '👤 Введите кому выдано:');
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
    await sendMessage(chatId, '👤 Введите кому выдано:');
    return;
  }
  
  // Confirm document
  if (data === 'confirm_document') {
    const tx = await createTransaction(session.ownerId || linkedUser.user_id, session.data, supabase);
    if (tx) {
      await sendMessage(chatId, '✅ Документ успешно сохранён!', getMainMenu());
      
      await supabase
        .from('payout_image_tracking')
        .insert({
          owner_user_id: session.ownerId || linkedUser.user_id,
          transaction_id: tx.id,
          submitter_name: session.data.submitterName || 'Telegram',
          telegram_chat_id: chatId,
        });
    } else {
      await sendMessage(chatId, '❌ Ошибка при сохранении документа');
    }
    session.step = 'idle';
    setSession(chatId, session);
    return;
  }
  
  // Cancel document
  if (data === 'cancel_document') {
    session.step = 'idle';
    setSession(chatId, session);
    await sendMessage(chatId, '❌ Отменено', getMainMenu());
    return;
  }
  
  // Expenses by department
  if (data === 'expenses_by_dept') {
    const expenses = await getExpensesByDepartment(linkedUser.user_id, supabase);
    if (expenses.length === 0) {
      await sendMessage(chatId, '📊 Нет данных о расходах');
      return;
    }
    
    let text = '📊 <b>Расходы по отделам:</b>\n\n';
    for (const exp of expenses) {
      text += `📁 ${exp.name}: ${exp.amounts || '0'}\n`;
    }
    
    await sendMessage(chatId, text, getMainMenu());
    return;
  }
  
  // Unfinished session
  if (data === 'unfinished_session') {
    const userName = registeredName || '';
    if (!userName) {
      await sendMessage(chatId, '❌ Имя не найдено. Отправьте /start и введите Имя и Фамилию.');
      return;
    }

    const searchPattern = `%[Bez załączników%]%`;

    const { data: pendingTx } = await supabase
      .from('transactions')
      .select('id, amount, currency, description, date, category_id, issued_to')
      .eq('user_id', linkedUser.user_id)
      .eq('type', 'expense')
      .like('description', searchPattern)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!pendingTx || pendingTx.length === 0) {
      await sendMessage(chatId, '✅ У вас нет незаконченных сессий (все фото добавлены).');
      return;
    }

    const links = await getSharedLinks(linkedUser.user_id, supabase);
    const activeLink = links.length > 0 ? links[0] : null;

    if (!activeLink) {
      await sendMessage(chatId, '❌ Нет активных ссылок. Создайте ссылку в приложении.');
      return;
    }

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', linkedUser.user_id);

    let text = '📷 <b>Незаконченная сессия — документы без фото:</b>\n\n';
    const buttons: Array<Array<{text: string, url: string}>> = [];

    for (const tx of pendingTx) {
      const catName = categories?.find(c => c.id === tx.category_id)?.name || '';
      const dateStr = new Date(tx.date).toLocaleDateString('ru-RU');
      const currencySymbol = tx.currency === 'EUR' ? '€' : tx.currency === 'USD' ? '$' : tx.currency;
      const recipient = tx.issued_to || '';
      text += `📄 ${catName ? catName + ' — ' : ''}${Number(tx.amount).toLocaleString()} ${currencySymbol}${recipient ? '\n👤 ' + recipient : ''}\n📅 ${dateStr}\n\n`;
      
      const payoutUrl = `${APP_URL}/payout/${activeLink.token}`;
      buttons.push([{ text: `📎 ${recipient || catName || 'Документ'} — ${Number(tx.amount).toLocaleString()} ${currencySymbol}`, url: payoutUrl }]);
    }

    text += 'Нажмите на документ, чтобы добавить фото:';

    await sendMessage(chatId, text, { inline_keyboard: buttons });
    return;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  const url = new URL(req.url);
  if (url.searchParams.get('setup') === 'true') {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-bot`;
    const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    
    console.log('Setting webhook URL:', webhookUrl);
    
    const response = await fetch(telegramUrl);
    const result = await response.json();
    
    console.log('Webhook setup result:', result);
    
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
