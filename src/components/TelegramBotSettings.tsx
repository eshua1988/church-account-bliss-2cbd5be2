import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Link2, Unlink, Copy, ExternalLink, RefreshCw, CheckCircle, Plus } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const MAX_BOTS = 3;

interface ConnectedBot {
  id: string;
  telegram_chat_id: number;
  is_active: boolean;
}

export function TelegramBotSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [chatId, setChatId] = useState('');
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
      .select('id, telegram_chat_id, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true);
    
    setConnectedBots(data || []);
  };

  const handleConnect = async () => {
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
    
    // Check if already connected by this user
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
                    Подключен
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

        {/* Add bot form / button */}
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
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium">Как подключить:</p>
              <ol className="text-sm text-muted-foreground space-y-2">
                <li className="flex items-start gap-2">
                  <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">1</span>
                  <span>
                    Откройте бота в Telegram:
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
                  <span>Отправьте команду /start (только в личных сообщениях)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">3</span>
                  <span>Нажмите "Подключить аккаунт" и скопируйте Chat ID</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="bg-primary text-primary-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">4</span>
                  <span>Вставьте Chat ID ниже и нажмите "Подключить"</span>
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
                <Button onClick={handleConnect} disabled={loading || !chatId.trim()}>
                  <Link2 className="w-4 h-4 mr-2" />
                  Подключить
                </Button>
              </div>
            </div>
            
            {connectedBots.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setChatId(''); }}>
                Отмена
              </Button>
            )}
          </div>
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
