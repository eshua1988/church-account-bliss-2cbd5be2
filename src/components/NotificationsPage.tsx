import { useState, useEffect } from 'react';
import { Mail, Check, CheckCheck, Trash2, X, Download, Loader2, ImageOff, ImagePlus, PlusCircle } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { openPdfUrl } from '@/lib/pdfDownload';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { Currency } from '@/types/transaction';

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
  resolvedDepartment,
  payoutToken,
  onAddToTransaction,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  resolvedDepartment?: string;
  payoutToken?: string;
  onAddToTransaction?: (notification: Notification) => void;
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const { toast } = useToast();
  const transactionId = notification.metadata?.transaction_id as string | undefined;
  const pdfPath = notification.metadata?.pdf_path as string | undefined;

  const handleDownloadPdf = async () => {
    if (!transactionId) return;
    setIsDownloading(true);
    try {
      // Try pdf_path from metadata first, then fallback to listing storage folder
      let filePath = pdfPath;

      if (!filePath) {
        const userId = notification.user_id;
        const { data: files, error: listError } = await supabase.storage
          .from('documents')
          .list(`${userId}/${transactionId}`);
        if (listError) console.error('Storage list error:', listError);
        const pdfFile = files?.find(f => f.name.endsWith('.pdf'));
        if (pdfFile) {
          filePath = `${userId}/${transactionId}/${pdfFile.name}`;
        }
      }

      if (!filePath) {
        toast({ title: 'PDF не найден', description: 'Файл ещё не загружен или был удалён', variant: 'destructive' });
        return;
      }

      const { data: urlData, error: urlError } = await supabase.storage
        .from('documents')
        .createSignedUrl(filePath, 60 * 60);

      if (urlError) console.error('Signed URL error:', urlError);

      if (urlData?.signedUrl) {
        openPdfUrl(urlData.signedUrl);
      } else {
        toast({ title: 'Ошибка', description: 'Не удалось получить ссылку на PDF', variant: 'destructive' });
      }
    } catch (e) {
      console.error('PDF download error:', e);
      toast({ title: 'Ошибка загрузки PDF', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  const issuedTo = notification.metadata?.issued_to as string | undefined;
  const departmentName = (notification.metadata?.department_name as string | undefined) || resolvedDepartment;
  const amount = notification.metadata?.amount;
  const currency = notification.metadata?.currency as string | undefined;
  const imagesSkipped = notification.metadata?.images_skipped as boolean | undefined;
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const payoutUrl = payoutToken
    ? `${baseUrl}/payout/${payoutToken}?txid=${encodeURIComponent(transactionId || '')}&name=${encodeURIComponent(issuedTo || '')}`
    : undefined;

  return (
    <div
      className={cn(
        'p-4 sm:p-5 rounded-xl border border-border transition-all duration-200 hover:shadow-md',
        !notification.is_read
          ? 'bg-primary/5 border-primary/20'
          : 'bg-card'
      )}
    >
      {/* Top row: name + unread dot | amount+currency + delete */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {!notification.is_read && (
            <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
          )}
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate leading-snug">
              {issuedTo || notification.title}
            </p>
            {departmentName && (
              <p className="text-sm text-muted-foreground mt-0.5 truncate leading-snug">
                {departmentName}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {amount != null && currency && (
            <span className="font-bold text-primary text-base whitespace-nowrap">
              {amount} {currency}
            </span>
          )}
          {!notification.is_read && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onMarkAsRead(notification.id)}
              title="Отметить как прочитанное"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(notification.id)}
            title="Удалить"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Bottom row: date | action buttons */}
      <div className="flex items-end justify-between mt-3 gap-2">
        <p className="text-xs text-muted-foreground flex-shrink-0">
          {format(new Date(notification.created_at), 'dd.MM.yyyy HH:mm')}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {imagesSkipped && payoutUrl && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-7 px-2.5 text-xs border-yellow-500/50 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-500/10"
              onClick={() => window.open(payoutUrl, '_blank')}
            >
              <ImagePlus className="h-3 w-3" />
              Добавить фото
            </Button>
          )}
          {transactionId && (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 h-7 px-2.5 text-xs"
              onClick={handleDownloadPdf}
              disabled={isDownloading}
            >
              {isDownloading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3" />
              )}
              {isDownloading ? '...' : 'PDF'}
            </Button>
          )}
          {!transactionId && onAddToTransaction && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 px-2.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
              onClick={() => onAddToTransaction(notification)}
            >
              <PlusCircle className="h-3 w-3" />
              В расход
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export const NotificationsPage = () => {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
  } = useNotifications();

  const { user } = useAuth();
  const { toast } = useToast();
  const { addTransaction } = useSupabaseTransactions();
  const { getExpenseCategories } = useSupabaseCategories();
  const expenseCategories = getExpenseCategories();

  const [activeTab, setActiveTab] = useState<'all' | 'no_photos'>('all');
  // Map transactionId -> cashier_name for notifications without department_name in metadata
  const [deptMap, setDeptMap] = useState<Record<string, string>>({});
  // Fallback payout token for old notifications that don't have link_token in metadata
  const [fallbackToken, setFallbackToken] = useState<string | undefined>();

  // Dialog state for adding a transaction from a notification
  const [addTxNotif, setAddTxNotif] = useState<Notification | null>(null);
  const [txAmount, setTxAmount] = useState('');
  const [txCurrency, setTxCurrency] = useState<Currency>('PLN');
  const [txCategory, setTxCategory] = useState('');
  const [txDescription, setTxDescription] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);
  const [txSaving, setTxSaving] = useState(false);

  const openAddTxDialog = (notification: Notification) => {
    const meta = notification.metadata;
    setTxAmount(String(meta?.amount ?? ''));
    setTxCurrency((meta?.currency as Currency) ?? 'PLN');
    setTxDescription(
      [meta?.issued_to, meta?.basis].filter(Boolean).join(' — ') || notification.message
    );
    setTxDate(new Date().toISOString().split('T')[0]);
    const cats = getExpenseCategories();
    setTxCategory(cats[0]?.id ?? '');
    setAddTxNotif(notification);
  };

  const handleAddTx = async () => {
    if (!txAmount || !txCategory) return;
    setTxSaving(true);
    try {
      const saved = await addTransaction({
        type: 'expense',
        amount: parseFloat(txAmount),
        currency: txCurrency,
        category: txCategory as any,
        description: txDescription,
        date: new Date(txDate),
      });
      // Update notification metadata with transaction_id so the PDF button appears
      if (saved?.id && addTxNotif) {
        await supabase
          .from('notifications')
          .update({
            metadata: { ...(addTxNotif.metadata ?? {}), transaction_id: saved.id },
          })
          .eq('id', addTxNotif.id);
      }
      toast({ title: 'Расход добавлен', description: `${txAmount} ${txCurrency}` });
      setAddTxNotif(null);
    } catch (e) {
      console.error(e);
      toast({ title: 'Ошибка', description: 'Не удалось добавить транзакцию', variant: 'destructive' });
    } finally {
      setTxSaving(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    supabase
      .from('shared_payout_links')
      .select('token')
      .eq('owner_user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setFallbackToken(data[0].token);
      });
  }, [user]);

  useEffect(() => {
    const ids = notifications
      .filter(n => !n.metadata?.department_name && n.metadata?.transaction_id)
      .map(n => n.metadata!.transaction_id as string);
    if (ids.length === 0) return;
    supabase
      .from('transactions')
      .select('id, cashier_name')
      .in('id', ids)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        data.forEach((tx: { id: string; cashier_name: string | null }) => {
          if (tx.cashier_name) map[tx.id] = tx.cashier_name;
        });
        setDeptMap(map);
      });
  }, [notifications]);

  const withPhotos = notifications.filter(n => !n.metadata?.images_skipped);
  const withoutPhotos = notifications.filter(n => n.metadata?.images_skipped);
  const displayed = activeTab === 'all' ? withPhotos : withoutPhotos;
  const noPhotosUnread = withoutPhotos.filter(n => !n.is_read).length;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Mail className="h-6 w-6 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">
            Уведомления
            {unreadCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({unreadCount} непрочитанных)
              </span>
            )}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Прочитать все
            </Button>
          )}
          {notifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={clearAllNotifications}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Очистить
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-border">
        <button
          onClick={() => setActiveTab('all')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Все
          {withPhotos.length > 0 && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {withPhotos.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('no_photos')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'no_photos'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <ImageOff className="h-3.5 w-3.5" />
          Без вложений
          {withoutPhotos.length > 0 && (
            <span className={cn(
              'ml-1 text-xs rounded-full px-1.5 py-0.5',
              noPhotosUnread > 0
                ? 'bg-yellow-500/20 text-yellow-500 font-semibold'
                : 'bg-muted text-muted-foreground'
            )}>
              {withoutPhotos.length}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка...
        </div>
      ) : displayed.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground">
          <Mail className="h-16 w-16 mx-auto mb-4 opacity-30" />
          {activeTab === 'all' ? (
            <>
              <p className="text-lg">Нет уведомлений</p>
              <p className="text-sm mt-1">Здесь будут отображаться расходные ордера с фото</p>
            </>
          ) : (
            <>
              <ImageOff className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg">Нет ордеров без вложений</p>
              <p className="text-sm mt-1">Все ордера содержат фотовложения</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onMarkAsRead={markAsRead}
              onDelete={deleteNotification}
              resolvedDepartment={deptMap[notification.metadata?.transaction_id as string] || undefined}
              payoutToken={notification.metadata?.link_token || fallbackToken}
              onAddToTransaction={openAddTxDialog}
            />
          ))}
          <p className="text-xs text-center text-muted-foreground pt-2">
            Отображается до 25 последних уведомлений
          </p>
        </div>
      )}

      {/* Dialog: add transaction from notification */}
      <Dialog open={!!addTxNotif} onOpenChange={(open) => { if (!open) setAddTxNotif(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить расход</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Сумма</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={txAmount}
                  onChange={e => setTxAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Валюта</Label>
                <Select value={txCurrency} onValueChange={v => setTxCurrency(v as Currency)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['PLN','USD','EUR','UAH','BYN'].map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Категория</Label>
              <Select value={txCategory} onValueChange={setTxCategory}>
                <SelectTrigger><SelectValue placeholder="Выберите категорию" /></SelectTrigger>
                <SelectContent>
                  {expenseCategories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Описание</Label>
              <Input
                value={txDescription}
                onChange={e => setTxDescription(e.target.value)}
                placeholder="Описание"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Дата</Label>
              <Input
                type="date"
                value={txDate}
                onChange={e => setTxDate(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAddTxNotif(null)}>Отмена</Button>
            <Button onClick={handleAddTx} disabled={txSaving || !txAmount || !txCategory}>
              {txSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlusCircle className="h-4 w-4 mr-2" />}
              Добавить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
