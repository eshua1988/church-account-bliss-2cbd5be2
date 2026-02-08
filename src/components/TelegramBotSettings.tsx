import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Bot, Link2, Unlink, Copy, ExternalLink } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';

export function TelegramBotSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [chatId, setChatId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [connectedChatId, setConnectedChatId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      checkConnection();
    }
  }, [user]);

  const checkConnection = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('telegram_users')
      .select('telegram_chat_id, is_active')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();
    
    if (data) {
      setIsConnected(true);
      setConnectedChatId(data.telegram_chat_id.toString());
    } else {
      setIsConnected(false);
      setConnectedChatId(null);
    }
  };

  const handleConnect = async () => {
    if (!user || !chatId.trim()) {
      toast({
        title: 'Ошибка',
        description: 'Введите Chat ID',
        variant: 'destructive',
      });
      return;
    }
    
    const chatIdNum = parseInt(chatId.trim(), 10);
    if (isNaN(chatIdNum)) {
      toast({
        title: 'Ошибка',
        description: 'Chat ID должен быть числом',
        variant: 'destructive',
      });
      return;
    }
    
    setLoading(true);
    
    try {
      // Check if already connected to another user
      const { data: existing } = await supabase
        .from('telegram_users')
        .select('user_id')
        .eq('telegram_chat_id', chatIdNum)
        .eq('is_active', true)
        .single();
      
      if (existing && existing.user_id !== user.id) {
        toast({
          title: 'Ошибка',
          description: 'Этот Telegram-аккаунт уже подключен к другому пользователю',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
      
      // Upsert connection
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
      
      setIsConnected(true);
      setConnectedChatId(chatId.trim());
      setChatId('');
      
      toast({
        title: 'Успешно',
        description: 'Telegram-бот подключен',
      });
    } catch (error) {
      console.error('Error connecting Telegram:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось подключить Telegram-бот',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    
    setLoading(true);
    
    try {
      const { error } = await supabase
        .from('telegram_users')
        .update({ is_active: false })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setIsConnected(false);
      setConnectedChatId(null);
      
      toast({
        title: 'Успешно',
        description: 'Telegram-бот отключен',
      });
    } catch (error) {
      console.error('Error disconnecting Telegram:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось отключить Telegram-бот',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: 'Скопировано',
      description: 'Скопировано в буфер обмена',
    });
  };

  const botUsername = 'ChurchAccountBot'; // Replace with actual bot username

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="w-5 h-5" />
          Telegram-бот
        </CardTitle>
        <CardDescription>
          Подключите Telegram-бот для заполнения документов, просмотра расходов и отслеживания без фото
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                <Link2 className="w-3 h-3 mr-1" />
                Подключен
              </Badge>
              {connectedChatId && (
                <span className="text-sm text-muted-foreground">
                  Chat ID: {connectedChatId}
                </span>
              )}
            </div>
            
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <p className="text-sm font-medium">Возможности бота:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Заполнение расходного ордера через чат</li>
                <li>• Выбор публичных ссылок для заполнения</li>
                <li>• Просмотр расходов по отделам</li>
                <li>• Список пользователей без фото</li>
              </ul>
            </div>
            
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={loading}
              className="w-full sm:w-auto"
            >
              <Unlink className="w-4 h-4 mr-2" />
              Отключить бота
            </Button>
          </div>
        ) : (
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
                  <span>Отправьте команду /start</span>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
