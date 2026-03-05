import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Link2, Unlink, ExternalLink, RefreshCw, CheckCircle, Plus, Key, Copy, Hash, ArrowLeft, ArrowRight, Zap } from 'lucide-react';

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
  // Wizard state
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardToken, setWizardToken] = useState('');
  const [wizardChatId, setWizardChatId] = useState('');
  const [verifiedBotName, setVerifiedBotName] = useState('');
  const [connectedBots, setConnectedBots] = useState<ConnectedBot[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

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

  const resetWizard = () => {
    setWizardStep(1);
    setWizardToken('');
    setWizardChatId('');
    setVerifiedBotName('');
    setWebhookStatus('idle');
    setShowAddForm(false);
  };

  // Step 1: Verify bot token via Telegram API
  const verifyToken = async () => {
    if (!wizardToken.trim()) {
      toast({ title: 'Ошибка', description: 'Введите токен бота', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`https://api.telegram.org/bot${wizardToken.trim()}/getMe`);
      const result = await response.json();
      if (result.ok) {
        setVerifiedBotName(result.result.username ? `@${result.result.username}` : result.result.first_name);
        setWizardStep(2);
        toast({ title: 'Токен подтверждён', description: `Бот ${result.result.username ? '@' + result.result.username : result.result.first_name} найден` });
      } else {
        toast({ title: 'Ошибка', description: 'Недействительный токен бота', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось проверить токен', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Connect bot with token + chat ID
  const connectWithWizard = async () => {
    if (!user || !wizardChatId.trim()) {
      toast({ title: 'Ошибка', description: 'Введите Chat ID', variant: 'destructive' });
      return;
    }
    if (connectedBots.length >= MAX_BOTS) {
      toast({ title: 'Ошибка', description: `Максимум ${MAX_BOTS} бота`, variant: 'destructive' });
      return;
    }
    const chatIdNum = parseInt(wizardChatId.trim(), 10);
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
        return;
      }
      const { error } = await supabase
        .from('telegram_users')
        .upsert({
          user_id: user.id,
          telegram_chat_id: chatIdNum,
          is_active: true,
          bot_token: wizardToken.trim() || null,
        }, { onConflict: 'telegram_chat_id' });
      if (error) throw error;
      await loadConnectedBots();
      setWizardStep(3);
      toast({ title: 'Бот подключён!', description: `${verifiedBotName || 'Telegram-бот'} привязан к вашему аккаунту` });
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось подключить Telegram-бот', variant: 'destructive' });
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
      toast({ title: 'Успешно', description: 'Telegram-бот отключён' });
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось отключить Telegram-бот', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const activateWebhook = async () => {
    setWebhookStatus('loading');
    try {
      let response: Response;
      if (wizardToken.trim()) {
        // Custom bot — set webhook for this specific token
        response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup_custom=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token: wizardToken.trim() }),
        });
      } else {
        // Shared bot
        response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup=true`);
      }
      const result = await response.json();
      if (result.ok) {
        setWebhookStatus('success');
        toast({ title: 'Успешно', description: 'Telegram webhook активирован' });
      } else {
        setWebhookStatus('error');
        toast({ title: 'Ошибка', description: result.description || 'Не удалось активировать webhook', variant: 'destructive' });
      }
    } catch {
      setWebhookStatus('error');
      toast({ title: 'Ошибка', description: 'Не удалось подключиться к серверу', variant: 'destructive' });
    }
  };

  const reactivateWebhook = async (token: string | null) => {
    setLoading(true);
    try {
      let response: Response;
      if (token) {
        response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup_custom=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bot_token: token }),
        });
      } else {
        response = await fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?setup=true`);
      }
      const result = await response.json();
      if (result.ok) {
        toast({ title: 'Webhook активирован', description: 'Бот готов к работе' });
      } else {
        toast({ title: 'Ошибка webhook', description: result.description || 'Не удалось активировать', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось подключиться к серверу', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: 'Скопировано', description: 'Скопировано в буфер обмена' });
  };

  const botUsername = 'churchAccountingOfFinances_bot';

  const STEPS = [
    { num: 1, label: 'Токен' },
    { num: 2, label: 'Chat ID' },
    { num: 3, label: 'Webhook' },
  ];

  const showWizard = showAddForm || connectedBots.length === 0;

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
                    {bot.bot_token ? 'Свой бот' : 'Подключён'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">Chat ID: {bot.telegram_chat_id}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => reactivateWebhook(bot.bot_token)}
                    disabled={loading}
                    title="Переактивировать webhook"
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Zap className="w-4 h-4" />
                  </Button>
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
              </div>
            ))}
          </div>
        )}

        {/* Bot capabilities */}
        {connectedBots.length > 0 && !showAddForm && (
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

        {/* Open wizard button */}
        {connectedBots.length < MAX_BOTS && !showAddForm && connectedBots.length > 0 && (
          <Button
            variant="outline"
            onClick={() => { setShowAddForm(true); setWizardStep(1); }}
            className="w-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            Добавить ещё бота
          </Button>
        )}

        {/* === WIZARD === */}
        {showWizard && connectedBots.length < MAX_BOTS && (
          <div className="border rounded-xl p-4 space-y-5">

            {/* Step indicator */}
            <div className="flex items-center justify-between">
              {STEPS.map((step, idx) => (
                <div key={step.num} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors
                      ${wizardStep > step.num ? 'bg-primary text-primary-foreground' : wizardStep === step.num ? 'bg-primary text-primary-foreground ring-2 ring-primary/30' : 'bg-muted text-muted-foreground'}`}>
                      {wizardStep > step.num ? <CheckCircle className="w-4 h-4" /> : step.num}
                    </div>
                    <span className={`text-xs ${wizardStep === step.num ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                      {step.label}
                    </span>
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 mb-4 rounded ${wizardStep > step.num ? 'bg-primary' : 'bg-muted'}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Step 1: API Token */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Key className="w-4 h-4" /> Шаг 1: Токен бота
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Получите API Token у{' '}
                    <Button variant="link" className="h-auto p-0 text-sm" onClick={() => window.open('https://t.me/BotFather', '_blank')}>
                      @BotFather <ExternalLink className="w-3 h-3 ml-0.5 inline" />
                    </Button>{' '}
                    — создайте бота командой <code className="bg-muted px-1 rounded text-xs">/newbot</code> и скопируйте токен.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wizardToken">API Token бота</Label>
                  <Input
                    id="wizardToken"
                    value={wizardToken}
                    onChange={(e) => setWizardToken(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && verifyToken()}
                    placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                    type="password"
                    autoComplete="off"
                  />
                </div>
                <div className="flex justify-between items-center">
                  {connectedBots.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={resetWizard}>
                      <ArrowLeft className="w-4 h-4 mr-1" /> Отмена
                    </Button>
                  )}
                  <Button onClick={verifyToken} disabled={loading || !wizardToken.trim()} className="ml-auto">
                    {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                    Проверить и далее
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: Chat ID */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                {verifiedBotName && (
                  <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                    <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium">Бот {verifiedBotName} подтверждён</span>
                  </div>
                )}
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Hash className="w-4 h-4" /> Шаг 2: Chat ID
                  </p>
                  <p className="text-sm text-muted-foreground">Откройте бот <Button variant="link" className="h-auto p-0 text-sm" onClick={() => window.open('https://t.me/userinfobot', '_blank')}>@userinfobot <ExternalLink className="w-3 h-3 ml-0.5 inline" /></Button> в Telegram, нажмите <b>Start</b> — он ответит вашим Chat ID. Скопируйте число и вставьте ниже.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wizardChatId">Chat ID</Label>
                  <Input
                    id="wizardChatId"
                    value={wizardChatId}
                    onChange={(e) => setWizardChatId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && connectWithWizard()}
                    placeholder="Например: 123456789"
                    type="number"
                  />
                </div>
                <div className="flex justify-between">
                  <Button variant="ghost" size="sm" onClick={() => setWizardStep(1)}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> Назад
                  </Button>
                  <Button onClick={connectWithWizard} disabled={loading || !wizardChatId.trim()}>
                    {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                    Подключить
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Webhook */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-primary/10 rounded-lg px-3 py-2">
                  <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-sm font-medium">Бот успешно подключён!</span>
                </div>
                <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Zap className="w-4 h-4" /> Шаг 3: Активация Webhook
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Активируйте webhook, чтобы бот получал сообщения и отвечал в реальном времени. Это нужно сделать один раз.
                  </p>
                </div>
                <Button
                  onClick={activateWebhook}
                  disabled={webhookStatus === 'loading'}
                  className="w-full"
                  variant={webhookStatus === 'success' ? 'outline' : 'default'}
                >
                  {webhookStatus === 'loading' ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : webhookStatus === 'success' ? (
                    <CheckCircle className="w-4 h-4 mr-2 text-primary" />
                  ) : (
                    <Zap className="w-4 h-4 mr-2" />
                  )}
                  {webhookStatus === 'success' ? 'Webhook активирован' : 'Активировать Webhook'}
                </Button>
                {webhookStatus === 'success' && (
                  <Button variant="outline" size="sm" className="w-full" onClick={resetWizard}>
                    Готово
                  </Button>
                )}
                {webhookStatus !== 'success' && (
                  <Button variant="ghost" size="sm" className="w-full" onClick={resetWizard}>
                    Пропустить
                  </Button>
                )}
              </div>
            )}

          </div>
        )}

      </CardContent>
    </Card>
  );
}
