import { useState, useEffect, useRef } from 'react';
import { Mail, Check, CheckCheck, Trash2, X, Download, Loader2, ImageOff, ImagePlus, PlusCircle, QrCode, Copy, Banknote, ExternalLink } from 'lucide-react';
import { useNotifications, Notification } from '@/hooks/useNotifications';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { openPdfUrl } from '@/lib/pdfDownload';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { Currency } from '@/types/transaction';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const OTHER_DEPARTMENT_BY_TYPE = {
  income: 'Прочее (доход)',
  expense: 'Прочее (расход)',
} as const;

const normalizeRuleTerm = (term: string) => term.trim().replace(/\s+/g, ' ');

const mergeRuleTerms = (existingText: string, newTerms: string[]) => {
  const existingTerms = existingText.split(',').map(normalizeRuleTerm).filter(Boolean);
  const seen = new Set(existingTerms.map(term => term.toLowerCase()));
  const merged = [...existingTerms];

  for (const term of newTerms.map(normalizeRuleTerm).filter(Boolean)) {
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(term);
    }
  }

  return merged.join(', ');
};

const isRuleRequestNotification = (notification: Notification) =>
  notification.type === 'rule_request' ||
  notification.metadata?.request_type === 'department_rule_terms';

// Detect account type and build QR string
function buildPaymentQr(account: string, amount: number, currency: string, recipientName: string, title: string): { qrValue: string; type: 'blik' | 'iban' | 'phone' } {
  const clean = account.replace(/\s/g, '');
  // IBAN: starts with 2 letters + digits, length 15-34
  const isIban = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/i.test(clean);
  if (isIban) {
    // Polish bank QR standard: 2|1|IBAN|Name|AmountGrosze|Title||
    const amountGrosze = currency === 'PLN' ? Math.round(amount * 100) : Math.round(amount * 100);
    const qrValue = `2|1|${clean.toUpperCase()}|${recipientName}|${amountGrosze}|${title}||`;
    return { qrValue, type: 'iban' };
  }
  // Phone: 9 digits or +48xxxxxxxxx
  const isPhone = /^(\+?48)?[0-9]{9}$/.test(clean);
  if (isPhone) {
    const normalized = clean.startsWith('+') ? clean : clean.length === 9 ? `+48${clean}` : `+${clean}`;
    return { qrValue: normalized, type: 'blik' };
  }
  return { qrValue: account, type: 'phone' };
}

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
  resolvedDepartment,
  payoutToken,
  onAddToTransaction,
  onApproveRuleRequest,
  onRejectRuleRequest,
  savingId,
  swipedId,
  onSwipe,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  resolvedDepartment?: string;
  payoutToken?: string;
  onAddToTransaction?: (notification: Notification) => void;
  onApproveRuleRequest?: (notification: Notification) => void;
  onRejectRuleRequest?: (notification: Notification) => void;
  savingId?: string | null;
  swipedId?: string | null;
  onSwipe?: (id: string | null) => void;
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiped, setIsSwiped] = useState(false);

  const { toast } = useToast();
  const transactionId = notification.metadata?.transaction_id as string | undefined;
  const pdfPath = notification.metadata?.pdf_path as string | undefined;
  const isSaving = savingId === notification.id;
  const isRuleRequest = isRuleRequestNotification(notification);
  const requestedTerms = Array.isArray(notification.metadata?.terms)
    ? (notification.metadata.terms as unknown[]).map(String).join(', ')
    : '';

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      // Use pdf_path from metadata first (works even without transactionId)
      let filePath = pdfPath;

      if (!filePath && transactionId) {
        const userId = notification.user_id;
        const { data: files } = await supabase.storage
          .from('documents')
          .list(`${userId}/${transactionId}`);
        const pdfFile = files?.find(f => f.name.endsWith('.pdf'));
        if (pdfFile) filePath = `${userId}/${transactionId}/${pdfFile.name}`;
      }

      if (!filePath) {
        toast({ title: 'PDF не найден', description: 'Файл ещё не загружен или был удалён', variant: 'destructive' });
        return;
      }

      // Use Edge Function (service_role) to create signed URL — avoids client auth token issues
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const userId = notification.user_id;
      const params = new URLSearchParams({ action: 'sign', filePath, userId });
      const res = await fetch(
        `${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      const json = await res.json();

      if (json.signedUrl) {
        openPdfUrl(json.signedUrl);
      } else {
        console.error('[PDF sign] error from edge function:', json);
        toast({ title: 'Ошибка', description: json.error || 'Не удалось получить ссылку на PDF', variant: 'destructive' });
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
  const amount = notification.metadata?.amount as number | undefined;
  const currency = notification.metadata?.currency as string | undefined;
  const imagesSkipped = notification.metadata?.images_skipped as boolean | undefined;
  const bankAccount = notification.metadata?.bank_account as string | undefined;
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const payoutUrl = payoutToken
    ? `${baseUrl}/payout/${payoutToken}?name=${encodeURIComponent(issuedTo || '')}`
    : undefined;

  const paymentQr = bankAccount && amount
    ? buildPaymentQr(bankAccount, amount, currency || 'PLN', issuedTo || '', departmentName || 'Расходный ордер')
    : null;

  const BTN_W = 64;
  const mobileButtonCount =
    1 + // delete — always
    (!notification.is_read ? 1 : 0) + // mark as read
    (isRuleRequest ? 2 : 0) +
    (onAddToTransaction && !transactionId ? 1 : 0) +
    (imagesSkipped && payoutUrl ? 1 : 0) +
    ((pdfPath || transactionId) ? 1 : 0) +
    (paymentQr ? 1 : 0);
  const SWIPE_MAX = mobileButtonCount * BTN_W;
  const SWIPE_THRESHOLD = 50;

  // Close this card if another was swiped open
  const isThisSwiped = swipedId === notification.id;
  useEffect(() => {
    if (!isThisSwiped && isSwiped) {
      setIsSwiped(false);
      setSwipeOffset(0);
    }
  }, [isThisSwiped]);

  // Resync swipe offset when button count changes (e.g. is_read updated → tray shrinks/grows)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isSwiped) setSwipeOffset(SWIPE_MAX);
  }, [SWIPE_MAX]);

  const doClose = () => { setIsSwiped(false); setSwipeOffset(0); onSwipe?.(null); };
  const doOpen = () => { setIsSwiped(true); setSwipeOffset(SWIPE_MAX); onSwipe?.(notification.id); };
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dx = touchStartX.current - e.touches[0].clientX;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);
    if (dy > 15 && dy > Math.abs(dx)) { isDragging.current = false; return; }
    const base = isSwiped ? SWIPE_MAX : 0;
    const next = Math.max(0, Math.min(base + dx, SWIPE_MAX));
    setSwipeOffset(next);
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    if (swipeOffset > SWIPE_THRESHOLD) {
      doOpen();
    } else {
      doClose();
    }
  };

  // Action buttons — shared between desktop bottom row and mobile swipe tray
  const actionButtons = (
    <>
      {onAddToTransaction && !transactionId && !isRuleRequest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs border-primary/40 text-primary hover:bg-primary/10"
          onClick={() => { onAddToTransaction(notification); doClose(); }}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
          {isSaving ? '...' : 'В расход'}
        </Button>
      )}
      {isRuleRequest && onApproveRuleRequest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs border-green-500/50 text-green-600 hover:text-green-700 hover:bg-green-500/10"
          onClick={() => { onApproveRuleRequest(notification); doClose(); }}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          Подтвердить
        </Button>
      )}
      {isRuleRequest && onRejectRuleRequest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs border-destructive/50 text-destructive hover:bg-destructive/10"
          onClick={() => { onRejectRuleRequest(notification); doClose(); }}
          disabled={isSaving}
        >
          <X className="h-3 w-3" />
          Отклонить
        </Button>
      )}
      {imagesSkipped && payoutUrl && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 h-8 px-2.5 text-xs border-yellow-500/50 text-yellow-600 hover:text-yellow-700 hover:bg-yellow-500/10"
          onClick={() => { window.open(payoutUrl, '_blank'); doClose(); }}
        >
          <ImagePlus className="h-3 w-3" />
          Добавить
        </Button>
      )}
      {(pdfPath || transactionId) && (
        <Button
          variant="default"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs"
          onClick={() => { handleDownloadPdf(); doClose(); }}
          disabled={isDownloading}
        >
          {isDownloading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          {isDownloading ? '...' : 'PDF'}
        </Button>
      )}
      {paymentQr && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1 h-8 px-2.5 text-xs border-green-500/50 text-green-600 hover:text-green-700 hover:bg-green-500/10"
          onClick={() => { setShowQr(true); doClose(); }}
        >
          <QrCode className="h-3 w-3" />
          Оплатить
        </Button>
      )}
    </>
  );

  return (
    <>
    {/* Mobile swipe wrapper */}
    <div
      className="relative overflow-hidden rounded-xl bg-card"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Action tray — Telegram-style (mobile only) */}
      <div
        className="sm:hidden absolute right-0 top-0 bottom-0 flex rounded-r-xl overflow-hidden"
        style={{ width: `${SWIPE_MAX}px` }}
      >
        {onAddToTransaction && !transactionId && !isRuleRequest && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-blue-600 active:bg-blue-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onAddToTransaction(notification); doClose(); }}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlusCircle className="h-5 w-5" />}
            <span className="text-[11px] font-medium leading-none">В расход</span>
          </button>
        )}
        {isRuleRequest && onApproveRuleRequest && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-green-600 active:bg-green-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onApproveRuleRequest(notification); doClose(); }}
            disabled={isSaving}
          >
            {isSaving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            <span className="text-[11px] font-medium leading-none">Да</span>
          </button>
        )}
        {isRuleRequest && onRejectRuleRequest && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-red-600 active:bg-red-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onRejectRuleRequest(notification); doClose(); }}
            disabled={isSaving}
          >
            <X className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Нет</span>
          </button>
        )}
        {imagesSkipped && payoutUrl && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-amber-500 active:bg-amber-600"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { window.open(payoutUrl, '_blank'); doClose(); }}
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Добавить</span>
          </button>
        )}
        {(pdfPath || transactionId) && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-slate-600 active:bg-slate-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { handleDownloadPdf(); doClose(); }}
            disabled={isDownloading}
          >
            {isDownloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            <span className="text-[11px] font-medium leading-none">PDF</span>
          </button>
        )}
        {paymentQr && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-green-600 active:bg-green-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { setShowQr(true); doClose(); }}
          >
            <QrCode className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Оплатить</span>
          </button>
        )}
        {!notification.is_read && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-indigo-500 active:bg-indigo-600"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onMarkAsRead(notification.id); doClose(); }}
          >
            <Check className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Прочит.</span>
          </button>
        )}
        <button
          className="flex flex-col items-center justify-center gap-1 text-white bg-red-600 active:bg-red-700"
          style={{ width: `${BTN_W}px` }}
          onClick={() => { onDelete(notification.id); doClose(); }}
        >
          <Trash2 className="h-5 w-5" />
          <span className="text-[11px] font-medium leading-none">Удалить</span>
        </button>
      </div>

      {/* Main card — slides left on swipe */}
      <div
        className={cn(
          'p-4 rounded-xl border transition-colors duration-200 hover:shadow-md bg-card',
          !notification.is_read ? 'border-primary/40 border-l-4 border-l-primary' : 'border-border'
        )}
        style={{
          transform: `translateX(-${swipeOffset}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.2s ease',
        }}
      >
        {/* Top row: name + unread dot | amount+currency + delete */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            {!notification.is_read && (
              <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate leading-snug">
                {isRuleRequest ? notification.title : issuedTo || notification.title}
              </p>
              {isRuleRequest ? (
                <p className="text-sm text-muted-foreground mt-0.5 truncate leading-snug">
                  {requestedTerms || notification.message}
                </p>
              ) : departmentName && (
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
            <Button variant="ghost" size="icon"
              className="hidden sm:inline-flex h-7 w-7 text-destructive hover:text-destructive"
              onClick={() => onDelete(notification.id)} title="Удалить">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Bottom row: date | action buttons (desktop only) */}
        <div className="flex items-end justify-between mt-3 gap-2">
          <p className="text-xs text-muted-foreground flex-shrink-0">
            {format(new Date(notification.created_at), 'dd.MM.yyyy HH:mm')}
          </p>
          {/* Desktop buttons — hidden on mobile (use swipe instead) */}
          <div className="hidden sm:flex items-center gap-1.5 flex-wrap justify-end">
            {actionButtons}
          </div>
          {/* Mobile: swipe hint when no swipe yet and there are actions */}
          <div className="flex sm:hidden items-center gap-1 text-xs text-muted-foreground">
            {(onAddToTransaction || isRuleRequest || imagesSkipped || pdfPath || transactionId || paymentQr) && !isSwiped && (
              <span className="flex items-center gap-0.5 opacity-50">← действия</span>
            )}
          </div>
        </div>
      </div>
    </div>

    {/* Payment Dialog */}
    {paymentQr && (
      <Dialog open={showQr} onOpenChange={setShowQr}>
        <DialogContent className="max-w-xs w-full">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-primary" />
              {paymentQr.type === 'blik' ? 'Оплата через BLIK' : 'Банковский перевод'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-1">
            {/* Account / Phone */}
            <div className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground mb-0.5">
                  {paymentQr.type === 'blik' ? 'Номер телефона (BLIK)' : 'Счёт IBAN'}
                </p>
                <p className="font-mono text-sm font-semibold truncate">{bankAccount}</p>
              </div>
              <Button
                variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
                onClick={() => { navigator.clipboard.writeText(bankAccount || ''); toast({ title: 'Скопировано' }); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* Recipient */}
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground mb-0.5">Получатель</p>
                <p className="text-sm font-medium truncate">{issuedTo || '—'}</p>
              </div>
            </div>
            {/* Amount */}
            <div className="flex items-center justify-between gap-2 bg-muted rounded-lg px-3 py-2.5">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Сумма</p>
                <p className="text-base font-bold text-primary">{amount} {currency}</p>
              </div>
              <Button
                variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0"
                onClick={() => { navigator.clipboard.writeText(`${amount}`); toast({ title: 'Скопировано' }); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* Action button */}
            {paymentQr.type === 'blik' ? (
              <a
                href={`tel:${paymentQr.qrValue}`}
                className="w-full"
                onClick={() => setShowQr(false)}
              >
                <Button className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <ExternalLink className="h-4 w-4" />
                  Открыть в приложении банка
                </Button>
              </a>
            ) : (
              <Button
                className="w-full gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  const details = `${paymentQr.type === 'iban' ? 'IBAN' : 'Счёт'}: ${bankAccount}\nПолучатель: ${issuedTo || '—'}\nСумма: ${amount} ${currency}`;
                  navigator.clipboard.writeText(details);
                  toast({ title: 'Реквизиты скопированы', description: 'Вставьте в приложение банка' });
                  setShowQr(false);
                }}
              >
                <Copy className="h-4 w-4" />
                Скопировать реквизиты
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
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
    refetch: refetchNotifications,
    pushPermission,
    enablePushNotifications,
  } = useNotifications();

  const { user } = useAuth();
  const { toast } = useToast();
  const { addTransaction } = useSupabaseTransactions();
  const { getExpenseCategories } = useSupabaseCategories();

  const [activeTab, setActiveTab] = useState<'all' | 'no_photos' | 'extension'>('all');
  const [deptMap, setDeptMap] = useState<Record<string, string>>({});
  const [fallbackToken, setFallbackToken] = useState<string | undefined>();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);

  const upsertOtherRuleTerms = async (transactionType: 'income' | 'expense', terms: string[]) => {
    if (!user) throw new Error('User not authenticated');
    const departmentName = OTHER_DEPARTMENT_BY_TYPE[transactionType];

    const { data: existingRules, error: loadError } = await supabase
      .from('department_rules')
      .select('id, search_text, department_name, transaction_type')
      .eq('user_id', user.id)
      .eq('transaction_type', transactionType)
      .order('created_at', { ascending: true });

    if (loadError) throw loadError;

    const otherRules = (existingRules || []).filter(rule =>
      String(rule.department_name || '').toLowerCase().includes('прочее')
    );
    const primaryRule =
      otherRules.find(rule => rule.department_name === departmentName) ||
      otherRules[0];

    if (!primaryRule) {
      const { error: insertError } = await supabase
        .from('department_rules')
        .insert({
          user_id: user.id,
          search_text: mergeRuleTerms('', terms),
          department_name: departmentName,
          transaction_type: transactionType,
        } as any);
      if (insertError) throw insertError;
      return;
    }

    const duplicateRules = otherRules.filter(rule => rule.id !== primaryRule.id);
    const duplicateTerms = duplicateRules.flatMap(rule =>
      String(rule.search_text || '').split(',').map(normalizeRuleTerm).filter(Boolean)
    );
    const mergedText = mergeRuleTerms(String(primaryRule.search_text || ''), [...duplicateTerms, ...terms]);

    const { error: updateError } = await supabase
      .from('department_rules')
      .update({
        search_text: mergedText,
        department_name: departmentName,
        transaction_type: transactionType,
      } as any)
      .eq('id', primaryRule.id)
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    if (duplicateRules.length > 0) {
      const { error: deleteError } = await supabase
        .from('department_rules')
        .delete()
        .eq('user_id', user.id)
        .in('id', duplicateRules.map(rule => rule.id));
      if (deleteError) throw deleteError;
    }
  };

  const handleApproveRuleRequest = async (notification: Notification) => {
    const terms = Array.isArray(notification.metadata?.terms)
      ? (notification.metadata.terms as unknown[]).map(String).map(normalizeRuleTerm).filter(Boolean)
      : [];
    const transactionTypes = Array.isArray(notification.metadata?.transaction_types)
      ? (notification.metadata.transaction_types as unknown[]).filter((type): type is 'income' | 'expense' => type === 'income' || type === 'expense')
      : [];

    if (terms.length === 0 || transactionTypes.length === 0) {
      toast({ title: 'Нет слов для добавления', variant: 'destructive' });
      return;
    }

    setSavingId(notification.id);
    try {
      for (const transactionType of Array.from(new Set(transactionTypes))) {
        await upsertOtherRuleTerms(transactionType, terms);
      }

      await deleteNotification(notification.id);
      await refetchNotifications();
      toast({ title: 'Слова добавлены в поиск', description: terms.join(', ') });
    } catch (error) {
      console.error('Failed to approve rule request:', error);
      toast({
        title: 'Ошибка',
        description: error instanceof Error ? error.message : 'Не удалось добавить слова',
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleRejectRuleRequest = async (notification: Notification) => {
    await deleteNotification(notification.id);
    toast({ title: 'Запрос отклонён' });
  };

  // Directly save transaction from notification metadata — no dialog
  const handleAddToTransaction = async (notification: Notification) => {
    const meta = notification.metadata;
    const amount = meta?.amount;
    const currency = (meta?.currency as Currency) ?? 'PLN';
    if (!amount) {
      toast({ title: 'Нет суммы в уведомлении', variant: 'destructive' });
      return;
    }

    const cats = getExpenseCategories();
    // Try to match category: first by category_id, then by department_name, fallback to first
    const deptName = meta?.department_name as string | undefined;
    const preselectedCat = meta?.category_id
      ? cats.find(c => c.id === (meta.category_id as string))
      : deptName
        ? cats.find(c => c.name === deptName)
        : undefined;
    const categoryId = preselectedCat?.id ?? cats[0]?.id;
    if (!categoryId) {
      toast({ title: 'Нет категорий расходов', description: 'Добавьте категорию в настройках', variant: 'destructive' });
      return;
    }

    setSavingId(notification.id);
    try {
      const txDate = (meta?.date as string)
        ? new Date(meta.date as string)
        : new Date();

      const saved = await addTransaction({
        type: 'expense',
        amount: parseFloat(String(amount)),
        currency,
        category: categoryId as any,
        description: (meta?.basis as string) || undefined,
        date: txDate,
        issuedTo: (meta?.issued_to as string) || undefined,
        amountInWords: (meta?.amount_in_words as string) || undefined,
        decisionNumber: (meta?.decision_number as string) || undefined,
        departmentName: (meta?.department_name as string) || undefined,
        bankTitle: (meta?.basis as string) || undefined,
      });

      // Write transaction_id back to notification metadata
      if (saved?.id) {
        await supabase
          .from('notifications')
          .update({ metadata: { ...(meta ?? {}), transaction_id: saved.id } })
          .eq('id', notification.id);
      }

      toast({ title: 'Расход записан', description: `${amount} ${currency}` });
    } catch (e) {
      console.error(e);
      toast({ title: 'Ошибка', description: 'Не удалось добавить транзакцию', variant: 'destructive' });
    } finally {
      setSavingId(null);
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

  const ruleRequests = notifications.filter(isRuleRequestNotification);
  const payoutNotifications = notifications.filter(n => !isRuleRequestNotification(n));
  const withoutPhotos = payoutNotifications.filter(n => n.metadata?.images_skipped);
  const displayed =
    activeTab === 'extension'
      ? ruleRequests
      : activeTab === 'all'
        ? payoutNotifications
        : withoutPhotos;
  const noPhotosUnread = withoutPhotos.filter(n => !n.is_read).length;
  const ruleRequestsUnread = ruleRequests.filter(n => !n.is_read).length;

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
          {pushPermission !== 'granted' && (
            <Button variant="outline" size="sm" onClick={enablePushNotifications}>
              Включить push
            </Button>
          )}
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
          {payoutNotifications.length > 0 && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {payoutNotifications.length}
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
        <button
          onClick={() => setActiveTab('extension')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'extension'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Расширение
          {ruleRequests.length > 0 && (
            <span className={cn(
              'ml-2 text-xs rounded-full px-1.5 py-0.5',
              ruleRequestsUnread > 0
                ? 'bg-yellow-500/20 text-yellow-500 font-semibold'
                : 'bg-muted text-muted-foreground'
            )}>
              {ruleRequests.length}
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
          ) : activeTab === 'extension' ? (
            <>
              <p className="text-lg">Нет запросов расширения</p>
              <p className="text-sm mt-1">Здесь будут заявки с внешней ссылки, которые нужно подтвердить</p>
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
              onAddToTransaction={handleAddToTransaction}
              onApproveRuleRequest={handleApproveRuleRequest}
              onRejectRuleRequest={handleRejectRuleRequest}
              savingId={savingId}
              swipedId={swipedId}
              onSwipe={setSwipedId}
            />
          ))}
          <p className="text-xs text-center text-muted-foreground pt-2">
            Отображается до 25 последних уведомлений
          </p>
        </div>
      )}
    </div>
  );
};
