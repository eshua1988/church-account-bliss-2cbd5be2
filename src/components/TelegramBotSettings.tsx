import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Link2, Unlink, ExternalLink, RefreshCw, CheckCircle, Plus, Key, Copy, Hash } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const MAX_BOTS = 3;

interface ConnectedBot {
  id: string;
  telegram_chat_id: number;
  is_active: boolean;
  bot_token: string | null;
}

export function TelegramBotSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [chatId, setChatId] = useState('');
  const [botToken, setBotToken] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [connectedBots, setConnectedBots] = useState<ConnectedBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [generatingCode, setGeneratingCode] = useState(false);

  useEffect(() => {
    if (user) {
      loadConnectedBots();
    }
  }, [user]);

  const loadConnectedBots = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('telegram_users')
      .select('id, telegram_chat_id, is_active, bot_token')
      .eq('user_id', user.id)
      .eq('is_active', true);
    
    setConnectedBots((data as ConnectedBot[]) || []);
  };

  const handleConnectByChatId = async () => {
    if (!user || !chatId.trim()) {
      toast({ title: 'Ошибка', description: 'Введите Chat ID', variant: 'destructive' });
      return;
    }
    
    if (connectedBots.length >= MAX_BOTS) {
      toast({ title: 'Ошибка', description: `Максимум ${MAX_BOTS} бота`, variant: 'destructive' });
      return;
    }
    
    const chatIdNum = parseInt(chatId.trim(), 10);
    if (isNaN(chatIdNum)) {
      toast({ title: 'Ошибка', description: 'Chat ID должен быть числом', variant: 'destructive' });
      return;
    }
    
    if (connectedBots.some(b => b.telegram_chat_id === chatIdNum)) {
      toast({ title: 'Ошибка', description: 'Этот Chat ID уже подключен', variant: 'destructive' });
      return;
    }
    
    setLoading(true);
    
    try {
      const { data: existing } = await supabase
        .from('telegram_users')
        .select('user_id')
        .eq('telegram_chat_id', chatIdNum)
        .eq('is_active', true)
        .single();
      
      if (existing && existing.user_id !== user.id) {
        toast({ title: 'Ошибка', description: 'Этот Telegram-аккаунт уже подключен к другому пользователю', variant: 'destructive' });
        setLoading(false);
        return;
      }
      
      const { error } = await supabase
        .from('telegram_users')
        .upsert({
          user_id: user.id,
          telegram_chat_id: chatIdNum,
          is_active: true,
        }, {
          onConflict: 'telegram_chat_id',
        });
      
      if (error) throw error;
      
      setChatId('');
      setShowAddForm(false);
      await loadConnectedBots();
      
      toast({ title: 'Успешно', description: 'Telegram-бот подключен' });
    } catch (error) {
      console.error('Error connecting Telegram:', error);
      toast({ title: 'Ошибка', description: 'Не удалось подключить Telegram-бот', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const generateLinkCode = async () => {
    if (!user) return;
    
    if (connectedBots.length >= MAX_BOTS) {
      toast({ title: 'Ошибка', description: `Максимум ${MAX_BOTS} бота`, variant: 'destructive' });
      return;
    }
    
    setGeneratingCode(true);
    
    try {
      // Generate random 6-char alphanumeric code
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      
      const { error } = await supabase
        .from('telegram_link_codes')
        .insert({
          user_id: user.id,
          code,
          bot_token: botToken.trim() || null,
        });
      
      if (error) throw error;
      
      setLinkCode(code);
      toast({ title: 'Код создан', description: 'Отправьте этот код боту в Telegram для привязки' });
    } catch (error) {
      console.error('Error generating link code:', error);
      toast({ title: 'Ошибка', description: 'Не удалось создать код', variant: 'destructive' });
    } finally {
      setGeneratingCode(false);
    }
  };

  const connectOwnBot = async () => {
    if (!user || !botToken.trim()) {
      toast({ title: 'Ошибка', description: 'Введите токен бота', variant: 'destructive' });
      return;
    }
    
    setLoading(true);
    
    try {
      // Verify token and set up webhook via edge function
      const response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup_custom=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bot_token: botToken.trim() }),
      });
      
      const result = await response.json();
      
      if (!result.ok) {
        toast({ title: 'Ошибка', description: result.description || 'Недействительный токен', variant: 'destructive' });
        setLoading(false);
        return;
      }
      
      // Generate a link code with the bot token
      await generateLinkCode();
      
      toast({ 
        title: 'Бот подключен!', 
        description: `Бот @${result.bot?.username} активирован. Отправьте код ${linkCode || ''} этому боту для привязки.` 
      });
    } catch (error) {
      console.error('Error connecting own bot:', error);
      toast({ title: 'Ошибка', description: 'Не удалось подключить бота', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (botId: string) => {
    if (!user) return;
    setLoading(true);
    
    try {
      const { error } = await supabase
        .from('telegram_users')
        .update({ is_active: false })
        .eq('id', botId)
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      await loadConnectedBots();
      toast({ title: 'Успешно', description: 'Telegram-бот отключен' });
    } catch (error) {
      console.error('Error disconnecting Telegram:', error);
      toast({ title: 'Ошибка', description: 'Не удалось отключить Telegram-бот', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const activateWebhook = async () => {
    setWebhookStatus('loading');
    
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup=true`);
      const result = await response.json();
      
      if (result.ok) {
        setWebhookStatus('success');
        toast({ title: 'Успешно', description: 'Telegram webhook активирован' });
      } else {
        setWebhookStatus('error');
        toast({ title: 'Ошибка', description: result.description || 'Не удалось активировать webhook', variant: 'destructive' });
      }
    } catch (error) {
      console.error('Webhook activation error:', error);
      setWebhookStatus('error');
      toast({ title: 'Ошибка', description: 'Не удалось подключиться к серверу', variant: 'destructive' });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', description: 'Код скопирован в буфер обмена' });
  };

  const botUsername = 'churchAccountingOfFinances_bot';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          Telegram-бот
        </CardTitle>
        <CardDescription>
          Подключите Telegram-бот для заполнения документов, просмотра расходов и отслеживания без фото (до {MAX_BOTS} ботов)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connected bots list */}
        {connectedBots.length > 0 && (
          <div className="space-y-3">
            {connectedBots.map((bot) => (
              <div key={bot.id} className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="border-primary/20">
                    <Link2 className="w-3 h-3 mr-1" />
                    {bot.bot_token ? 'Свой бот' : 'Подключен'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Chat ID: {bot.telegram_chat_id}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDisconnect(bot.id)}
                  disabled={loading}
                  className="text-destructive hover:text-destructive"
                >
                  <Unlink className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Bot capabilities */}
        {connectedBots.length > 0 && (
          <div className="bg-muted/50 rounded-lg p-4 space-y-2">
            <p className="text-sm font-medium">Возможности бота:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Заполнение расходного ордера через чат</li>
              <li>• Выбор публичных ссылок для заполнения</li>
              <li>• Просмотр расходов по отделам</li>
              <li>• Незаконченные сессии (документы без фото)</li>
            </ul>
          </div>
        )}

        {/* Add bot */}
        {connectedBots.length < MAX_BOTS && !showAddForm && (
          <Button
            variant="outline"
            onClick={() => setShowAddForm(true)}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            {connectedBots.length === 0 ? 'Подключить бота' : 'Добавить ещё бота'}
          </Button>
        )}

        {(showAddForm || connectedBots.length === 0) && connectedBots.length < MAX_BOTS && (
          <Tabs defaultValue="code" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="code">
                <Hash className="w-4 h-4 mr-1" />
                По коду
              </TabsTrigger>
              <TabsTrigger value="chatid">
                <Link2 className="w-4 h-4 mr-1" />
                По Chat ID
              </TabsTrigger>
              <TabsTrigger value="own_bot">
                <Key className="w-4 h-4 mr-1" />
                Свой бот
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Quick connect via code */}
            <TabsContent value="code" className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">Быстрое подключение через код:</p>
                <ol className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
                    <span>Нажмите "Сгенерировать код" ниже</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">2</span>
                    <span>
                      Откройте бота:
                      <Button
                        variant="link"
                        className="h-auto p-0 ml-1"
                        onClick={() => window.open(`https://t.me/${botUsername}`, '_blank')}
                      >
                        @{botUsername}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
                    <span>Отправьте код боту — аккаунт привяжется автоматически</span>
                  </li>
                </ol>
              </div>
              
              {linkCode ? (
                <div className="space-y-2">
                  <Label>Ваш код (действует 10 минут):</Label>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                      <span className="text-2xl font-mono font-bold tracking-widest">{linkCode}</span>
                    </div>
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(linkCode)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setLinkCode(''); generateLinkCode(); }}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Новый код
                  </Button>
                </div>
              ) : (
                <Button onClick={generateLinkCode} disabled={generatingCode} className="w-full">
                  {generatingCode ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Hash className="w-4 h-4 mr-2" />}
                  Сгенерировать код
                </Button>
              )}
            </TabsContent>

            {/* Tab 2: Connect by Chat ID */}
            <TabsContent value="chatid" className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">Подключение по Chat ID:</p>
                <ol className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
                    <span>
                      Откройте бота:
                      <Button
                        variant="link"
                        className="h-auto p-0 ml-1"
                        onClick={() => window.open(`https://t.me/${botUsername}`, '_blank')}
                      >
                        @{botUsername}
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">2</span>
                    <span>Отправьте /start и скопируйте Chat ID</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
                    <span>Вставьте Chat ID ниже</span>
                  </li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="chatId">Chat ID</Label>
                <div className="flex gap-2">
                  <Input
                    id="chatId"
                    value={chatId}
                    onChange={(e) => setChatId(e.target.value)}
                    placeholder="Введите Chat ID из Telegram"
                  />
                  <Button onClick={handleConnectByChatId} disabled={loading || !chatId.trim()}>
                    <Link2 className="w-4 h-4 mr-2" />
                    Подключить
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* Tab 3: Own bot token */}
            <TabsContent value="own_bot" className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium">Подключение своего бота:</p>
                <ol className="text-sm text-muted-foreground space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
                    <span>
                      Создайте бота через
                      <Button
                        variant="link"
                        className="h-auto p-0 ml-1"
                        onClick={() => window.open('https://t.me/BotFather', '_blank')}
                      >
                        @BotFather
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">2</span>
                    <span>Скопируйте API Token бота</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
                    <span>Вставьте токен ниже и подключите</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">4</span>
                    <span>Отправьте сгенерированный код вашему боту</span>
                  </li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="botToken">API Token бота</Label>
                <Input
                  id="botToken"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                  type="password"
                />
              </div>
              
              <Button onClick={connectOwnBot} disabled={loading || !botToken.trim()} className="w-full">
                {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Key className="w-4 h-4 mr-2" />}
                Подключить своего бота
              </Button>
              
              {linkCode && (
                <div className="space-y-2">
                  <Label>Отправьте этот код вашему боту:</Label>
                  <div className="flex gap-2 items-center">
                    <div className="flex-1 bg-muted rounded-lg p-3 text-center">
                      <span className="text-2xl font-mono font-bold tracking-widest">{linkCode}</span>
                    </div>
                    <Button variant="outline" size="icon" onClick={() => copyToClipboard(linkCode)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}

        {connectedBots.length > 0 && showAddForm && (
          <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setChatId(''); setBotToken(''); setLinkCode(''); }}>
            Отмена
          </Button>
        )}

        {/* Webhook activation */}
        {connectedBots.length > 0 && (
          <Button
            variant="outline"
            onClick={activateWebhook}
            disabled={webhookStatus === 'loading'}
          >
            {webhookStatus === 'loading' ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : webhookStatus === 'success' ? (
              <CheckCircle className="w-4 h-4 mr-2 text-primary" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Активировать Webhook
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
