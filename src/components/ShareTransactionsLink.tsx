import { useState, useEffect } from 'react';
import { Link2, QrCode, Copy, Check, Trash2, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface SharedLink {
  id: string;
  token: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
}

const generateToken = () => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => 
    byte.toString(16).padStart(2, '0')
  ).join('');
};

export const ShareTransactionsLink = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [links, setLinks] = useState<SharedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLinkName, setNewLinkName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<SharedLink | null>(null);
  const [showQrDialog, setShowQrDialog] = useState(false);

  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');

  useEffect(() => {
    if (user) {
      fetchLinks();
    }
  }, [user]);

  const fetchLinks = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('shared_transaction_links')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching links:', error);
        if (error.code === 'PGRST205') {
          toast({
            title: 'Требуется инициализация',
            description: 'Пожалуйста, выполните SQL скрипт из файла setup_shared_transaction_links.sql в Supabase SQL Editor',
            variant: 'destructive',
          });
        }
        return;
      }
      setLinks(data || []);
    } catch (err) {
      console.error('Error fetching links:', err);
    } finally {
      setLoading(false);
    }
  };

  const createLink = async () => {
    if (!user) return;

    try {
      const token = generateToken();
      const { data, error } = await supabase
        .from('shared_transaction_links')
        .insert({
          owner_user_id: user.id,
          token,
          name: newLinkName || null,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating link:', error);
        if (error.code === 'PGRST205') {
          toast({
            title: 'Требуется инициализация',
            description: 'Таблица не инициализирована. Пожалуйста, выполните SQL скрипт из файла setup_shared_transaction_links.sql в Supabase SQL Editor',
            variant: 'destructive',
          });
        } else {
          throw error;
        }
        return;
      }
      
      setLinks(prev => [data, ...prev]);
      setNewLinkName('');
      
      toast({
        title: 'Ссылка создана',
        description: 'Таблица транзакций доступна по ссылке',
      });
    } catch (err) {
      console.error('Error creating link:', err);
      toast({
        title: 'Ошибка',
        description: 'Не удалось создать ссылку',
        variant: 'destructive',
      });
    }
  };

  const deleteLink = async (id: string) => {
    try {
      const { error } = await supabase
        .from('shared_transaction_links')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setLinks(prev => prev.filter(l => l.id !== id));
      
      toast({
        title: 'Ссылка удалена',
        description: 'Ссылка на таблицу транзакций удалена',
      });
    } catch (err) {
      console.error('Error deleting link:', err);
    }
  };

  const copyLink = (token: string) => {
    const fullLink = `${baseUrl}/transactions/${token}`;
    navigator.clipboard.writeText(fullLink);
    setCopiedId(token);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      title: 'Скопировано',
      description: 'Ссылка скопирована в буфер обмена',
    });
  };

  const toggleActive = async (id: string, currentState: boolean) => {
    try {
      const { error } = await supabase
        .from('shared_transaction_links')
        .update({ is_active: !currentState })
        .eq('id', id);

      if (error) throw error;
      
      setLinks(prev => prev.map(l => 
        l.id === id ? { ...l, is_active: !currentState } : l
      ));
      
      toast({
        title: currentState ? 'Ссылка деактивирована' : 'Ссылка активирована',
      });
    } catch (err) {
      console.error('Error toggling link:', err);
    }
  };

  if (loading) {
    return <div>Загрузка...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          Ссылка на таблицу транзакций
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new link section */}
        <div className="space-y-3 p-3 bg-muted rounded-lg">
          <div>
            <Label htmlFor="link-name" className="text-sm">Название ссылки (опционально)</Label>
            <Input
              id="link-name"
              placeholder="Например: Отчет за апрель"
              value={newLinkName}
              onChange={(e) => setNewLinkName(e.target.value)}
              className="h-9 text-sm mt-1"
            />
          </div>
          <Button 
            onClick={createLink}
            className="w-full"
            size="sm"
          >
            <Plus className="w-4 h-4 mr-2" />
            Создать ссылку
          </Button>
        </div>

        {/* Links list */}
        <div className="space-y-2">
          {links.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Ещё нет ссылок на таблицу транзакций
            </p>
          ) : (
            links.map(link => (
              <div 
                key={link.id} 
                className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{link.name || 'Таблица транзакций'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {baseUrl}/transactions/{link.token.substring(0, 8)}...
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant={link.is_active ? 'default' : 'secondary'} className="text-xs">
                      {link.is_active ? 'Активна' : 'Неактивна'}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Dialog open={showQrDialog && selectedLink?.id === link.id} onOpenChange={(open) => {
                    setShowQrDialog(open);
                    if (open) setSelectedLink(link);
                  }}>
                    <DialogTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        title="QR код"
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>QR код ссылки</DialogTitle>
                      </DialogHeader>
                      <div className="flex justify-center p-4 bg-white rounded-lg">
                        <QRCodeSVG
                          value={`${baseUrl}/transactions/${link.token}`}
                          size={256}
                          level="H"
                          includeMargin={true}
                        />
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => copyLink(link.token)}
                    title="Копировать ссылку"
                  >
                    {copiedId === link.token ? (
                      <Check className="w-4 h-4 text-success" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    asChild
                    title="Открыть в новой вкладке"
                  >
                    <a href={`${baseUrl}/transactions/${link.token}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => toggleActive(link.id, link.is_active)}
                    title={link.is_active ? 'Деактивировать' : 'Активировать'}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded border',
                      link.is_active ? 'bg-primary border-primary' : 'border-muted-foreground'
                    )} />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    onClick={() => deleteLink(link.id)}
                    title="Удалить ссылку"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          📌 По ссылке люди смогут просматривать таблицу транзакций и искать по описанию, дате или сумме. Удаление и настройки недоступны.
        </p>
      </CardContent>
    </Card>
  );
};
