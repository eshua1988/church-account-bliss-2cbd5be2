import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  contact?: { phone_number: string; user_id: number };
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
  step: 'idle' | 'awaiting_link_selection' | 'filling_amount' | 'filling_currency' | 'filling_category' | 'filling_issued_to' | 'filling_description' | 'confirm';
  linkId?: string;
  linkName?: string;
  ownerId?: string;
  data: {
    amount?: number;
    currency?: string;
    categoryId?: string;
    issuedTo?: string;
    description?: string;
    submitterName?: string;
  };
}

// In-memory session storage (resets on function restart)
const sessions: Map<number, UserSession> = new Map();

const CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH', 'RUB', 'BYN'];

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

async function sendDocument(chatId: number, document: Blob, filename: string, caption?: string) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
  const formData = new FormData();
  formData.append('chat_id', chatId.toString());
  formData.append('document', document, filename);
  if (caption) {
    formData.append('caption', caption);
  }
  
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  
  return await response.json();
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
    .select('user_id, is_active')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .single();
  
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

async function getUsersWithoutImages(userId: string, supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('payout_image_tracking')
    .select('submitter_name, skipped_at, transaction_id')
    .eq('owner_user_id', userId)
    .order('skipped_at', { ascending: false })
    .limit(20);
  
  return data || [];
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

function getMainMenu(isLinked: boolean) {
  if (!isLinked) {
    return {
      inline_keyboard: [
        [{ text: '🔗 Подключить аккаунт', callback_data: 'link_account' }],
      ],
    };
  }
  
  return {
    inline_keyboard: [
      [{ text: '📝 Заполнить документ', callback_data: 'fill_document' }],
      [{ text: '🔗 Выбрать ссылку для заполнения', callback_data: 'select_link' }],
      [{ text: '📊 Расходы по отделам', callback_data: 'expenses_by_dept' }],
      [{ text: '📷 Кто не добавил фото', callback_data: 'users_without_images' }],
      [{ text: '❌ Отключить аккаунт', callback_data: 'unlink_account' }],
    ],
  };
}

async function handleMessage(message: TelegramMessage, supabase: ReturnType<typeof createClient>) {
  const chatId = message.chat.id;
  const text = message.text?.trim() || '';
  const session = sessions.get(chatId);
  
  console.log(`Message from ${chatId}: ${text}, session step: ${session?.step}`);
  
  // Handle commands
  if (text === '/start' || text === '/menu') {
    const linkedUser = await getLinkedUser(chatId, supabase);
    const isLinked = !!linkedUser;
    
    await sendMessage(
      chatId,
      isLinked 
        ? '👋 Добро пожаловать! Выберите действие:'
        : '👋 Добро пожаловать! Для начала работы подключите свой аккаунт.',
      getMainMenu(isLinked)
    );
    sessions.delete(chatId);
    return;
  }
  
  // Handle session-based input
  if (session) {
    switch (session.step) {
      case 'filling_amount':
        const amount = parseFloat(text.replace(',', '.'));
        if (isNaN(amount) || amount <= 0) {
          await sendMessage(chatId, '❌ Введите корректную сумму (число больше 0)');
          return;
        }
        session.data.amount = amount;
        session.step = 'filling_currency';
        sessions.set(chatId, session);
        
        await sendMessage(chatId, '💱 Выберите валюту:', {
          inline_keyboard: CURRENCIES.map(c => [{ text: c, callback_data: `currency_${c}` }]),
        });
        return;
        
      case 'filling_issued_to':
        session.data.issuedTo = text;
        session.step = 'filling_description';
        sessions.set(chatId, session);
        await sendMessage(chatId, '📝 Введите описание (или /skip чтобы пропустить):');
        return;
        
      case 'filling_description':
        if (text !== '/skip') {
          session.data.description = text;
        }
        session.step = 'confirm';
        sessions.set(chatId, session);
        
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
  
  // Unknown command
  const linkedUser = await getLinkedUser(chatId, supabase);
  await sendMessage(chatId, 'Используйте /menu для вызова главного меню', getMainMenu(!!linkedUser));
}

async function handleCallbackQuery(query: CallbackQuery, supabase: ReturnType<typeof createClient>) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = sessions.get(chatId) || { step: 'idle', data: {} };
  
  console.log(`Callback from ${chatId}: ${data}`);
  
  await answerCallbackQuery(query.id);
  
  // Link account
  if (data === 'link_account') {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    await sendMessage(
      chatId,
      `🔗 Для подключения аккаунта:\n\n1. Откройте настройки в приложении\n2. Перейдите в раздел "Telegram-бот"\n3. Введите код: <code>${code}</code>\n\nВаш Chat ID: <code>${chatId}</code>`,
    );
    return;
  }
  
  // Unlink account
  if (data === 'unlink_account') {
    await supabase
      .from('telegram_users')
      .update({ is_active: false })
      .eq('telegram_chat_id', chatId);
    
    sessions.delete(chatId);
    await sendMessage(chatId, '✅ Аккаунт отключен', getMainMenu(false));
    return;
  }
  
  const linkedUser = await getLinkedUser(chatId, supabase);
  if (!linkedUser) {
    await sendMessage(chatId, '❌ Сначала подключите аккаунт', getMainMenu(false));
    return;
  }
  
  // Select link for filling
  if (data === 'select_link') {
    const links = await getSharedLinks(linkedUser.user_id, supabase);
    if (links.length === 0) {
      await sendMessage(chatId, '❌ У вас нет активных публичных ссылок. Создайте их в приложении.');
      return;
    }
    
    await sendMessage(chatId, '🔗 Выберите ссылку для заполнения:', {
      inline_keyboard: links.map(link => [{
        text: `${link.name || 'Без названия'} (${link.link_type})`,
        callback_data: `link_${link.id}`,
      }]),
    });
    return;
  }
  
  // Link selected
  if (data.startsWith('link_')) {
    const linkId = data.replace('link_', '');
    const { data: linkData } = await supabase
      .from('shared_payout_links')
      .select('id, name, owner_user_id')
      .eq('id', linkId)
      .single();
    
    if (!linkData) {
      await sendMessage(chatId, '❌ Ссылка не найдена');
      return;
    }
    
    session.step = 'filling_amount';
    session.linkId = linkId;
    session.linkName = linkData.name;
    session.ownerId = linkData.owner_user_id;
    session.data = { submitterName: query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '') };
    sessions.set(chatId, session);
    
    await sendMessage(chatId, `📝 Заполнение документа: ${linkData.name || 'Без названия'}\n\n💰 Введите сумму:`);
    return;
  }
  
  // Fill document directly
  if (data === 'fill_document') {
    session.step = 'filling_amount';
    session.ownerId = linkedUser.user_id;
    session.data = { submitterName: query.from.first_name + (query.from.last_name ? ' ' + query.from.last_name : '') };
    sessions.set(chatId, session);
    
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
      sessions.set(chatId, session);
      
      await sendMessage(chatId, '📁 Выберите категорию (отдел):', {
        inline_keyboard: [
          ...categories.map(cat => [{ text: cat.name, callback_data: `category_${cat.id}` }]),
          [{ text: '➡️ Пропустить', callback_data: 'category_skip' }],
        ],
      });
    } else {
      session.step = 'filling_issued_to';
      sessions.set(chatId, session);
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
    sessions.set(chatId, session);
    await sendMessage(chatId, '👤 Введите кому выдано:');
    return;
  }
  
  // Confirm document
  if (data === 'confirm_document') {
    const tx = await createTransaction(session.ownerId || linkedUser.user_id, session.data, supabase);
    if (tx) {
      await sendMessage(chatId, '✅ Документ успешно сохранён!', getMainMenu(true));
      
      // Track if no images (always true for Telegram submissions)
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
    sessions.delete(chatId);
    return;
  }
  
  // Cancel document
  if (data === 'cancel_document') {
    sessions.delete(chatId);
    await sendMessage(chatId, '❌ Отменено', getMainMenu(true));
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
    
    await sendMessage(chatId, text, getMainMenu(true));
    return;
  }
  
  // Users without images
  if (data === 'users_without_images') {
    const users = await getUsersWithoutImages(linkedUser.user_id, supabase);
    if (users.length === 0) {
      await sendMessage(chatId, '📷 Нет записей о пользователях без фото');
      return;
    }
    
    let text = '📷 <b>Пользователи без фото:</b>\n\n';
    for (const user of users) {
      const date = new Date(user.skipped_at).toLocaleDateString('ru-RU');
      text += `👤 ${user.submitter_name} - ${date}\n`;
    }
    
    await sendMessage(chatId, text, getMainMenu(true));
    return;
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  // Handle webhook setup request
  const url = new URL(req.url);
  if (url.searchParams.get('setup') === 'true') {
    // Use the correct Supabase function URL
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
  
  // Handle Telegram updates
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
