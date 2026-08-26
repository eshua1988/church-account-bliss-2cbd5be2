import { useState, useEffect, useRef } from 'react';
import { Mail, Check, CheckCheck, Trash2, X, Download, Loader2, ImageOff, ImagePlus, PlusCircle, Banknote, BellRing, Archive, FolderArchive, FileText, ChevronDown, Building2, Pencil, Copy, Share2 } from 'lucide-react';
import JSZip from 'jszip';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  getNotificationArchiveMonth,
  getNotificationArchiveYear,
} from '@/lib/archiveFolders';
import { getArchivedNotifications } from '@/lib/notificationArchiveFilters';

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

const splitRuleTerms = (text: string) =>
  String(text || '').split(',').map(normalizeRuleTerm).filter(Boolean);

const isRuleRequestNotification = (notification: Notification) =>
  notification.type === 'rule_request' ||
  notification.metadata?.request_type === 'department_rule_terms';

const isDepositNotification = (notification: Notification) =>
  notification.type === 'deposit' || notification.metadata?.document_type === 'deposit';

const NOTIFICATIONS_PAGE_SIZE = 25;

const NotificationCard = ({
  notification,
  onMarkAsRead,
  onDelete,
  resolvedDepartment,
  payoutToken,
  onAddToTransaction,
  onApproveRuleRequest,
  onRejectRuleRequest,
  onArchive,
  onChangeDepartment,
  onEditDepositPdf,
  savingId,
  swipedId,
  onSwipe,
  selected,
  onSelectedChange,
}: {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  resolvedDepartment?: string;
  payoutToken?: string;
  onAddToTransaction?: (notification: Notification) => void;
  onApproveRuleRequest?: (notification: Notification) => void;
  onRejectRuleRequest?: (notification: Notification) => void;
  onArchive?: (notification: Notification) => void;
  onChangeDepartment?: (notification: Notification) => void;
  onEditDepositPdf?: (notification: Notification) => void;
  savingId?: string | null;
  swipedId?: string | null;
  onSwipe?: (id: string | null) => void;
  selected?: boolean;
  onSelectedChange?: (id: string, selected: boolean) => void;
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiped, setIsSwiped] = useState(false);

  const { toast } = useToast();
  const transactionId = notification.metadata?.transaction_id as string | undefined;
  const pdfPath = notification.metadata?.pdf_path as string | undefined;
  const isArchived = Boolean(notification.metadata?.archived_at);
  const isSaving = savingId === notification.id;
  const isRuleRequest = isRuleRequestNotification(notification);
  const isDeposit = notification.type === 'deposit' || notification.metadata?.document_type === 'deposit';
  const receiptCount = Math.max(
    1,
    Number(notification.metadata?.receipt_count)
      || (Array.isArray(notification.metadata?.receipts) ? notification.metadata.receipts.length : 0)
      || 1,
  );
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
        // Storage keeps the same PDF path after a cashier signature is saved.
        // A cache-busting query ensures Chrome does not show its old copy.
        openPdfUrl(`${json.signedUrl}${json.signedUrl.includes('?') ? '&' : '?'}v=${Date.now()}`);
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
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const payoutUrl = payoutToken
    ? `${baseUrl}/payout/${payoutToken}?name=${encodeURIComponent(issuedTo || '')}`
    : undefined;

  const BTN_W = 64;
  const mobileButtonCount =
    1 + // delete — always
    (!notification.is_read ? 1 : 0) + // mark as read
    (isRuleRequest ? 2 : 0) +
    (onAddToTransaction && !transactionId ? 1 : 0) +
    (imagesSkipped && payoutUrl ? 1 : 0) +
    ((pdfPath || transactionId) ? 1 : 0) +
    (onArchive && !isArchived && (pdfPath || transactionId) ? 1 : 0) +
    (onChangeDepartment && notification.type === 'payout' && !isRuleRequest ? 1 : 0) +
    (onEditDepositPdf && (isDeposit || notification.type === 'payout') && !isRuleRequest ? 1 : 0);
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
      {onChangeDepartment && notification.type === 'payout' && !isRuleRequest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs"
          onClick={() => { onChangeDepartment(notification); doClose(); }}
          disabled={isSaving}
        >
          <Pencil className="h-3 w-3" />
          PDF
        </Button>
      )}
      {onEditDepositPdf && (isDeposit || notification.type === 'payout') && !isRuleRequest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs"
          onClick={() => { onEditDepositPdf(notification); doClose(); }}
          disabled={isSaving}
        >
          <Pencil className="h-3 w-3" />
          Кассир
        </Button>
      )}
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
      {onArchive && !isArchived && (pdfPath || transactionId) && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
          onClick={() => { onArchive(notification); doClose(); }}
        >
          <Archive className="h-3 w-3" />
          В архив
        </Button>
      )}
    </>
  );

  return (
    <>
    {/* Mobile swipe wrapper */}
    <div
      className="relative w-full min-w-0 max-w-full touch-pan-y overflow-hidden overscroll-contain rounded-xl bg-card"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Action tray — Telegram-style (mobile only) */}
      <div
        className="sm:hidden absolute right-0 top-0 bottom-0 flex max-w-full rounded-r-xl overflow-hidden"
        style={{ width: `${SWIPE_MAX}px` }}
      >
        {onChangeDepartment && notification.type === 'payout' && !isRuleRequest && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-violet-600 active:bg-violet-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onChangeDepartment(notification); doClose(); }}
            disabled={isSaving}
          >
            <Pencil className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">PDF</span>
          </button>
        )}
        {onEditDepositPdf && (isDeposit || notification.type === 'payout') && !isRuleRequest && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-violet-600 active:bg-violet-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onEditDepositPdf(notification); doClose(); }}
            disabled={isSaving}
          >
            <Pencil className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Кассир</span>
          </button>
        )}
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
        {onArchive && !isArchived && (pdfPath || transactionId) && (
          <button
            className="flex flex-col items-center justify-center gap-1 text-white bg-amber-600 active:bg-amber-700"
            style={{ width: `${BTN_W}px` }}
            onClick={() => { onArchive(notification); doClose(); }}
          >
            <Archive className="h-5 w-5" />
            <span className="text-[11px] font-medium leading-none">Архив</span>
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
          selected
            ? 'border-primary ring-2 ring-primary/30'
            : !notification.is_read ? 'border-primary/40 border-l-4 border-l-primary' : 'border-border'
        )}
        style={{
          transform: `translateX(-${swipeOffset}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.2s ease',
        }}
      >
        {/* Top row: name + unread dot | amount+currency + delete */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <Checkbox
              checked={selected}
              onCheckedChange={(checked) => onSelectedChange?.(notification.id, checked === true)}
              onClick={(event) => event.stopPropagation()}
              aria-label="Выбрать уведомление"
              className="mt-0.5 shrink-0"
            />
            {!notification.is_read && (
              <div className="w-2.5 h-2.5 rounded-full bg-primary flex-shrink-0 mt-1.5" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-foreground truncate leading-snug">
                {isRuleRequest ? notification.title : issuedTo || notification.title}
              </p>
              {isRuleRequest ? (
                <p className="text-sm text-muted-foreground mt-0.5 truncate leading-snug">
                  {[String(notification.metadata?.requester_name || '').trim(), requestedTerms].filter(Boolean).join(' — ') || notification.message}
                </p>
              ) : departmentName && (
                <p className="text-sm text-muted-foreground mt-0.5 truncate leading-snug">
                  {departmentName}
                </p>
              )}
              {isDeposit && (
                <p className="text-xs text-muted-foreground mt-1">
                  Квитанций в PDF: {receiptCount}
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
            {(onAddToTransaction || isRuleRequest || imagesSkipped || pdfPath || transactionId) && !isSwiped && (
              <span className="flex items-center gap-0.5 opacity-50">← действия</span>
            )}
          </div>
        </div>
      </div>
    </div>

    </>
  );
};

export const NotificationsPage = () => {
  const {
    notifications,
    unreadCount,
    isLoading,
    markAsRead,
    markAsUnread,
    deleteNotification,
    refetch: refetchNotifications,
    pushPermission,
    hasPushSubscription,
    enablePushNotifications,
  } = useNotifications();

  const { user } = useAuth();
  const { toast } = useToast();
  const { addTransaction } = useSupabaseTransactions();
  const { categories, getExpenseCategories } = useSupabaseCategories();

  const [activeTab, setActiveTab] = useState<'all' | 'income' | 'no_photos' | 'extension'>('all');
  const [visibleNotificationsLimit, setVisibleNotificationsLimit] = useState(NOTIFICATIONS_PAGE_SIZE);
  const [deptMap, setDeptMap] = useState<Record<string, string>>({});
  const [fallbackToken, setFallbackToken] = useState<string | undefined>();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Notification | null>(null);
  const [departmentTarget, setDepartmentTarget] = useState<Notification | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [depositPdfTarget, setDepositPdfTarget] = useState<Notification | null>(null);
  const [selectedReceiptIndex, setSelectedReceiptIndex] = useState('0');
  const [cashierName, setCashierName] = useState('');
  const [signAllDepositReceipts, setSignAllDepositReceipts] = useState(false);
  const cashierSignatureRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCashierSignature = useRef(false);
  const [downloadingArchive, setDownloadingArchive] = useState<string | null>(null);
  const [expandedArchiveGroups, setExpandedArchiveGroups] = useState<Set<string>>(new Set());
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const selectedNotifications = notifications.filter(notification => selectedNotificationIds.has(notification.id));

  const toggleNotificationSelection = (id: string, selected: boolean) => {
    setSelectedNotificationIds(previous => {
      const next = new Set(previous);
      if (selected) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedNotificationIds(new Set());

  const selectedNotificationText = () => selectedNotifications
    .map(notification => {
      const metadata = notification.metadata || {};
      const name = String(metadata.issued_to || notification.title || 'Уведомление');
      const amount = metadata.amount != null ? ` — ${metadata.amount} ${metadata.currency || ''}`.trimEnd() : '';
      const createdAt = format(new Date(notification.created_at), 'dd.MM.yyyy HH:mm');
      return `${name}${amount} (${createdAt})`;
    })
    .join('\n');

  const handleBulkMarkAsRead = async () => {
    await Promise.all(selectedNotifications.filter(notification => !notification.is_read).map(notification => markAsRead(notification.id)));
    clearSelection();
  };

  const handleBulkMarkAsUnread = async () => {
    await Promise.all(selectedNotifications.filter(notification => notification.is_read).map(notification => markAsUnread(notification.id)));
    clearSelection();
  };

  const handleCopySelected = async () => {
    try {
      await navigator.clipboard.writeText(selectedNotificationText());
      toast({ title: 'Скопировано', description: `Уведомлений: ${selectedNotifications.length}` });
    } catch {
      toast({ title: 'Не удалось скопировать', variant: 'destructive' });
    }
  };

  const handleShareSelected = async () => {
    try {
      const text = selectedNotificationText();
      if (navigator.share) {
        await navigator.share({ title: 'Уведомления', text });
      } else {
        await navigator.clipboard.writeText(text);
        toast({ title: 'Скопировано', description: 'Передайте текст удобным способом.' });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast({ title: 'Не удалось передать', variant: 'destructive' });
    }
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      await Promise.all(selectedNotifications.map(notification => deleteNotification(notification.id)));
      toast({ title: 'Уведомления удалены', description: `Удалено: ${selectedNotifications.length}` });
      clearSelection();
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const depositReceipts = depositPdfTarget && Array.isArray(depositPdfTarget.metadata?.receipts)
    ? depositPdfTarget.metadata.receipts as Array<Record<string, unknown>>
    : depositPdfTarget
      ? [{
          issued_to: depositPdfTarget.metadata?.issued_to,
          amount: depositPdfTarget.metadata?.amount,
          currency: depositPdfTarget.metadata?.currency,
          date: depositPdfTarget.metadata?.date,
        }]
      : [];

  const clearCashierSignature = () => {
    const canvas = cashierSignatureRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const cashierPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height,
    };
  };

  const startCashierSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingCashierSignature.current = true;
    const point = cashierPointer(event);
    const context = event.currentTarget.getContext('2d');
    context?.beginPath();
    context?.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const drawCashierSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingCashierSignature.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = cashierPointer(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const openDepositPdfEditor = (notification: Notification) => {
    const receipts = Array.isArray(notification.metadata?.receipts)
      ? notification.metadata.receipts as Array<Record<string, unknown>>
      : [];
    setDepositPdfTarget(notification);
    setSelectedReceiptIndex('0');
    setCashierName(String(receipts[0]?.cashier || notification.metadata?.cashier || ''));
    setSignAllDepositReceipts(false);
    requestAnimationFrame(clearCashierSignature);
  };

  const savePayoutCashierPdf = async (clearSignature = false) => {
    if (!depositPdfTarget || (!clearSignature && !cashierName.trim())) return;
    const meta = depositPdfTarget.metadata || {};
    const pdfPath = String(meta.pdf_path || '');
    if (!pdfPath) throw new Error('PDF не найден');

    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const supabaseKey = (supabase as any).supabaseKey as string;
    const edgeHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    const signParams = new URLSearchParams({ action: 'sign', filePath: pdfPath, userId: depositPdfTarget.user_id });
    const signResponse = await fetch(`${supabaseUrl}/functions/v1/upload-payout-pdf?${signParams}`, { headers: edgeHeaders });
    const signResult = await signResponse.json();
    if (!signResponse.ok || !signResult.signedUrl) throw new Error(signResult.error || 'Не удалось открыть PDF');
    const sourceResponse = await fetch(signResult.signedUrl);
    if (!sourceResponse.ok) throw new Error(`Ошибка загрузки PDF: HTTP ${sourceResponse.status}`);

    const originalBytes = new Uint8Array(await sourceResponse.arrayBuffer());
    const [{ PDFDocument, rgb }, pdfjsLib] = await Promise.all([import('pdf-lib'), import('pdfjs-dist')]);
    const pdfDoc = await PDFDocument.load(originalBytes);
    const page = pdfDoc.getPage(0);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const mmX = pageWidth / 210;
    const mmY = pageHeight / 297;
    // Locate the cashier row(s) already present in the generated payout PDF.
    // Older PDFs may contain a duplicate row from the previous implementation.
    const cashierLabelYs: number[] = [];
    try {
      const sourcePdf = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
      const textContent = await (await sourcePdf.getPage(1)).getTextContent();
      textContent.items.forEach((item: any) => {
        const label = String(item.str || '').toLocaleLowerCase('pl');
        if (label.includes('kasjer') || label.includes('кассир') || label.includes('cashier')) {
          const labelY = Number(item.transform?.[5]);
          if (Number.isFinite(labelY) && !cashierLabelYs.some(y => Math.abs(y - labelY) < 2)) {
            cashierLabelYs.push(labelY);
          }
        }
      });
      await sourcePdf.destroy();
    } catch (error) {
      console.warn('Could not locate cashier row in payout PDF:', error);
    }

    if (cashierLabelYs.length === 0) {
      throw new Error('Nie znaleziono pola kasjera w tym PDF. Wygeneruj dokument ponownie przed podpisaniem.');
    }

    const signature = cashierSignatureRef.current;
    const rowX = 20 * mmX;
    const rowWidth = 155 * mmX;
    const rowHeight = 26 * mmY;
    const dividerX = rowX + rowWidth * 0.58;
    const cashierLabelY = Math.min(...cashierLabelYs);
    const rowTop = cashierLabelY + 8 * mmY;
    const rowBottom = rowTop - rowHeight;

    // Remove every detected cashier row before drawing the single canonical row.
    cashierLabelYs.forEach(labelY => {
      const existingTop = labelY + 8 * mmY;
      page.drawRectangle({
        x: rowX - 1 * mmX,
        y: existingTop - rowHeight - 1 * mmY,
        width: rowWidth + 2 * mmX,
        height: rowHeight + 2 * mmY,
        color: rgb(1, 1, 1),
      });
    });
    page.drawRectangle({ x: rowX, y: rowBottom, width: rowWidth, height: rowHeight, borderColor: rgb(0, 0, 0), borderWidth: 0.5 });
    page.drawLine({ start: { x: dividerX, y: rowBottom }, end: { x: dividerX, y: rowTop }, thickness: 0.5, color: rgb(0, 0, 0) });
    if (!clearSignature) {
      page.drawText(cashierName.trim(), { x: rowX + 3 * mmX, y: rowBottom + 9 * mmY, size: 9, maxWidth: dividerX - rowX - 6 * mmX });
      if (signature) {
        const cashierImage = await pdfDoc.embedPng(signature.toDataURL('image/png'));
        page.drawImage(cashierImage, { x: dividerX + 3 * mmX, y: rowBottom + 3 * mmY, width: rowX + rowWidth - dividerX - 6 * mmX, height: rowHeight - 6 * mmY });
      }
    }

    const token = String(meta.link_token || fallbackToken || '');
    if (!token) throw new Error('Не найден ключ для обновления PDF');
    const uploadParams = new URLSearchParams({ action: 'upload-url', filePath: pdfPath, token });
    const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/upload-payout-pdf?${uploadParams}`, { headers: edgeHeaders });
    const uploadResult = await uploadResponse.json();
    if (!uploadResponse.ok || !uploadResult.path || !uploadResult.token) throw new Error(uploadResult.error || 'Не удалось получить доступ для сохранения PDF');
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .uploadToSignedUrl(uploadResult.path, uploadResult.token, new Blob([await pdfDoc.save() as BlobPart], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    if (uploadError) throw uploadError;

    const updatedMetadata = clearSignature
      ? { ...meta, cashier: null, cashier_signed: false }
      : { ...meta, cashier: cashierName.trim(), cashier_signed: true };
    const { error: notificationError } = await supabase.from('notifications').update({ metadata: updatedMetadata }).eq('id', depositPdfTarget.id);
    if (notificationError) throw notificationError;
    const transactionId = String(meta.transaction_id || '');
    if (transactionId) {
      const { error: transactionError } = await supabase.from('transactions').update({ cashier_name: clearSignature ? null : cashierName.trim() }).eq('id', transactionId);
      if (transactionError) console.warn('Linked transaction cashier was not updated:', transactionError);
    }
  };

  const saveDepositPdf = async (clearSignature = false) => {
    if (!depositPdfTarget || (!clearSignature && !cashierName.trim())) return;
    if (depositPdfTarget.type === 'payout') {
      setSavingId(depositPdfTarget.id);
      try {
        await savePayoutCashierPdf(clearSignature);
        setDepositPdfTarget(null);
        await refetchNotifications();
        toast({
          title: clearSignature ? 'Подпись отменена' : 'PDF обновлён',
          description: clearSignature ? 'Подпись кассира удалена из расходного ордера.' : 'Имя и подпись кассира сохранены в расходном ордере.',
        });
      } catch (error) {
        toast({ title: 'Не удалось обновить PDF', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      } finally {
        setSavingId(null);
      }
      return;
    }
    const receiptIndex = Number(selectedReceiptIndex);
    const meta = depositPdfTarget.metadata || {};
    const pdfPath = String(meta.pdf_path || '');
    if (!pdfPath) return;

    setSavingId(depositPdfTarget.id);
    try {
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const edgeHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
      const signParams = new URLSearchParams({
        action: 'sign',
        filePath: pdfPath,
        userId: depositPdfTarget.user_id,
      });
      const signResponse = await fetch(
        `${supabaseUrl}/functions/v1/upload-payout-pdf?${signParams}`,
        { headers: edgeHeaders },
      );
      const signResult = await signResponse.json();
      if (!signResponse.ok || !signResult.signedUrl) {
        throw new Error(signResult.error || 'Не удалось открыть PDF');
      }
      const sourceResponse = await fetch(signResult.signedUrl);
      if (!sourceResponse.ok) throw new Error(`Ошибка загрузки PDF: HTTP ${sourceResponse.status}`);

      const originalBytes = new Uint8Array(await sourceResponse.arrayBuffer());
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(originalBytes);
      const receiptIndexes = signAllDepositReceipts
        ? depositReceipts.map((_, index) => index)
        : [receiptIndex];
      const selectedLayout = depositReceipts[receiptIndex] || {};
      const selectedHeightMm = Array.isArray(meta.receipts) ? 16 : 16;

      // A single receipt uses the 20–190 mm cashier row visible in the PDF.
      // The older two-receipts-per-page layout has its own wider row.
      const isMultiReceiptLayout = Array.isArray(meta.receipts);
      const cashierRowLeftMm = isMultiReceiptLayout ? 12 : 20;
      const cashierRowWidthMm = isMultiReceiptLayout ? 186 : 170;
      const cashierDividerRatio = isMultiReceiptLayout ? 0.68 : 0.6;
      const area = document.createElement('canvas');
      area.width = Math.round(cashierRowWidthMm * 10);
      area.height = Math.round(selectedHeightMm * 10);
      const context = area.getContext('2d');
      if (!context) throw new Error('Не удалось подготовить область кассира');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, area.width, area.height);
      context.strokeStyle = '#111111';
      context.lineWidth = 3;
      context.strokeRect(1.5, 1.5, area.width - 3, area.height - 3);
      const signatureStart = Math.round(area.width * cashierDividerRatio);
      context.beginPath();
      context.moveTo(signatureStart, 0);
      context.lineTo(signatureStart, area.height);
      context.stroke();
      context.fillStyle = '#111111';
      context.font = '38px Arial, sans-serif';
      context.textBaseline = 'middle';
      context.fillText('Kasjer:', 14, area.height / 2);
      context.font = '36px Arial, sans-serif';
      if (!clearSignature) context.fillText(cashierName.trim(), 155, area.height / 2, signatureStart - 175);
      const signature = cashierSignatureRef.current;
      if (!clearSignature && signature) {
        context.drawImage(
          signature,
          signatureStart + 12,
          8,
          area.width - signatureStart - 24,
          area.height - 16,
        );
      }
      const areaImage = await pdfDoc.embedPng(area.toDataURL('image/png'));
      receiptIndexes.forEach(index => {
        const receiptLayout = depositReceipts[index] || {};
        const pageIndex = Number.isFinite(Number(receiptLayout.page_index))
          ? Number(receiptLayout.page_index)
          : Math.floor(index / 2);
        if (pageIndex >= pdfDoc.getPageCount()) throw new Error('Квитанция не найдена в PDF');
        const page = pdfDoc.getPage(pageIndex);
        const { width: pageWidth, height: pageHeight } = page.getSize();
        const mmX = pageWidth / 210;
        const mmY = pageHeight / 297;
        // Deposit receipts use a fixed layout: after a 62 mm header, each
        // sender occupies 26 mm, then the 16 mm cashier row begins.
        const receiptOffset = Number(receiptLayout.offset_y_mm) || (index % 2 === 0 ? 10 : 153);
        const senderCount = Array.isArray(receiptLayout.senders) ? receiptLayout.senders.length : 2;
        const topMm = isMultiReceiptLayout
          ? receiptOffset + 62 + senderCount * 26
          : 137;
        const heightMm = selectedHeightMm;
        page.drawImage(areaImage, {
          x: cashierRowLeftMm * mmX,
          y: pageHeight - (topMm + heightMm) * mmY,
          width: cashierRowWidthMm * mmX,
          height: heightMm * mmY,
        });
      });

      const updatedBytes = await pdfDoc.save();
      const token = String(meta.link_token || fallbackToken || '');
      if (!token) throw new Error('Не найден ключ для обновления PDF');
      const uploadParams = new URLSearchParams({ action: 'upload-url', filePath: pdfPath, token });
      const uploadResponse = await fetch(
        `${supabaseUrl}/functions/v1/upload-payout-pdf?${uploadParams}`,
        { headers: edgeHeaders },
      );
      const uploadResult = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadResult.path || !uploadResult.token) {
        throw new Error(uploadResult.error || 'Не удалось получить доступ для сохранения PDF');
      }
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .uploadToSignedUrl(
          uploadResult.path,
          uploadResult.token,
          new Blob([updatedBytes as BlobPart], { type: 'application/pdf' }),
          { contentType: 'application/pdf' },
        );
      if (uploadError) throw uploadError;

      const receipts = Array.isArray(meta.receipts)
        ? (meta.receipts as Array<Record<string, unknown>>).map((receipt, index) =>
            receiptIndexes.includes(index)
              ? { ...receipt, cashier: clearSignature ? null : cashierName.trim(), cashier_signed: !clearSignature }
              : receipt)
        : undefined;
      const updatedMetadata = {
        ...meta,
        ...(receipts
          ? { receipts }
          : { cashier: clearSignature ? null : cashierName.trim(), cashier_signed: !clearSignature }),
      };
      const { error: updateError } = await supabase
        .from('notifications')
        .update({ metadata: updatedMetadata })
        .eq('id', depositPdfTarget.id);
      if (updateError) throw updateError;

      setDepositPdfTarget(null);
      await refetchNotifications();
      toast({
        title: clearSignature ? 'Подпись отменена' : 'PDF обновлён',
        description: clearSignature
          ? 'Подпись кассира удалена из PDF.'
          : signAllDepositReceipts
          ? 'Имя кассира и подпись сохранены во всех квитанциях PDF.'
          : 'Имя кассира и подпись сохранены в выбранной квитанции.',
      });
    } catch (error) {
      toast({
        title: 'Не удалось обновить PDF',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const regenerateNotificationPdf = async (notification: Notification, departmentName: string) => {
    const meta = notification.metadata || {};
    const folderKey = String(meta.transaction_id || meta.folder_key || '');
    if (!folderKey) throw new Error('Папка PDF не найдена');

    const date = String(meta.date || notification.created_at.slice(0, 10));
    const pdfPath = String(meta.pdf_path || `${notification.user_id}/${folderKey}/dowod_wyplaty_${date}_${folderKey.slice(0, 8)}.pdf`);
    const folderPath = `${notification.user_id}/${folderKey}`;
    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const supabaseKey = (supabase as any).supabaseKey as string;
    const edgeHeaders = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };
    const downloadProtectedFile = async (filePath: string) => {
      const params = new URLSearchParams({
        action: 'sign',
        filePath,
        userId: notification.user_id,
      });
      const signResponse = await fetch(
        `${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`,
        { headers: edgeHeaders },
      );
      const signResult = await signResponse.json();
      if (!signResponse.ok || !signResult.signedUrl) {
        throw new Error(signResult.error || `Не удалось открыть ${filePath.split('/').pop()}`);
      }
      const fileResponse = await fetch(signResult.signedUrl);
      if (!fileResponse.ok) {
        throw new Error(`Ошибка загрузки файла: HTTP ${fileResponse.status}`);
      }
      return fileResponse.blob();
    };
    // Edit the original PDF instead of rebuilding it. This preserves every
    // attachment page and the recipient signature already embedded in the file.
    const [{ PDFDocument, rgb }, pdfjsLib] = await Promise.all([
      import('pdf-lib'),
      import('pdfjs-dist'),
    ]);
    const originalPdf = await downloadProtectedFile(pdfPath);
    const originalBytes = new Uint8Array(await originalPdf.arrayBuffer());

    // Locate the department row from the PDF text layer. Both the client and
    // server PDF layouts use the same value-column X coordinate, but a
    // different Y coordinate, so reading the label makes the edit robust.
    let departmentBaseline: number | undefined;
    try {
      const sourcePdf = await pdfjsLib.getDocument({ data: originalBytes.slice() }).promise;
      const sourcePage = await sourcePdf.getPage(1);
      const textContent = await sourcePage.getTextContent();
      const departmentLabel = textContent.items.find((item: any) => {
        const text = String(item.str || '').toLocaleLowerCase('pl');
        return text.includes('nazwa') && (text.includes('dzia') || text.includes('department'));
      }) as any;
      if (departmentLabel?.transform) departmentBaseline = Number(departmentLabel.transform[5]);
      await sourcePdf.destroy();
    } catch (error) {
      console.warn('Could not locate department label in PDF, using standard layout:', error);
    }

    const pdfDoc = await PDFDocument.load(originalBytes);
    const firstPage = pdfDoc.getPage(0);
    const { width: pageWidth, height: pageHeight } = firstPage.getSize();
    const mmX = pageWidth / 210;
    const mmY = pageHeight / 297;
    const valueX = 70 * mmX;
    const valueWidth = 120 * mmX;
    const rowHeight = 10 * mmY;
    const baseline = departmentBaseline || pageHeight - (83 * mmY) - (6.5 * mmY);
    const valueY = baseline - (3.2 * mmY);

    firstPage.drawRectangle({
      x: valueX + 0.4 * mmX,
      y: valueY,
      width: valueWidth - 0.8 * mmX,
      height: rowHeight - 0.8 * mmY,
      color: rgb(1, 1, 1),
    });

    // Render the selected department through Canvas so Cyrillic text remains
    // supported without replacing or re-encoding the rest of the PDF.
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 150;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не удалось подготовить текст отдела');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    // The canvas is scaled into a 7 mm-high PDF area. 78 px produces the
    // same visual size as the other 10 pt values in the payout table.
    context.font = '78px Arial, sans-serif';
    context.textBaseline = 'middle';
    context.fillText(departmentName, 10, canvas.height / 2, canvas.width - 20);
    const departmentImage = await pdfDoc.embedPng(canvas.toDataURL('image/png'));
    firstPage.drawImage(departmentImage, {
      x: valueX + 3 * mmX,
      y: valueY + 1.2 * mmY,
      width: valueWidth - 6 * mmX,
      height: rowHeight - 3 * mmY,
    });

    const updatedBytes = await pdfDoc.save();
    const pdfBlob = new Blob([updatedBytes as BlobPart], { type: 'application/pdf' });
    const payoutToken = String(meta.link_token || fallbackToken || '');
    if (!payoutToken) throw new Error('Не найдена ссылка доступа для обновления PDF');
    const uploadParams = new URLSearchParams({
      action: 'upload-url',
      filePath: pdfPath,
      token: payoutToken,
    });
    const uploadUrlResponse = await fetch(
      `${supabaseUrl}/functions/v1/upload-payout-pdf?${uploadParams}`,
      { headers: edgeHeaders },
    );
    const uploadUrlResult = await uploadUrlResponse.json();
    if (!uploadUrlResponse.ok || !uploadUrlResult.token || !uploadUrlResult.path) {
      throw new Error(uploadUrlResult.error || 'Не удалось получить доступ для обновления PDF');
    }
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .uploadToSignedUrl(uploadUrlResult.path, uploadUrlResult.token, pdfBlob, {
        contentType: 'application/pdf',
      });
    if (uploadError) throw uploadError;
    return pdfPath;
  };

  const saveNotificationDepartment = async () => {
    if (!departmentTarget || !selectedDepartment) return;
    setSavingId(departmentTarget.id);
    try {
      const pdfPath = await regenerateNotificationPdf(departmentTarget, selectedDepartment);
      const metadata = {
        ...(departmentTarget.metadata || {}),
        department_name: selectedDepartment,
        pdf_path: pdfPath,
      };
      const { error } = await supabase
        .from('notifications')
        .update({ metadata })
        .eq('id', departmentTarget.id);
      if (error) throw error;

      const transactionId = departmentTarget.metadata?.transaction_id as string | undefined;
      if (transactionId) {
        const { error: transactionError } = await supabase
          .from('transactions')
          .update({ department_name: selectedDepartment, cashier_name: selectedDepartment } as any)
          .eq('id', transactionId);
        if (transactionError) {
          // Public payout notifications can reference a transaction owned by another
          // auth context. The notification and PDF are still authoritative here.
          console.warn('Linked transaction department was not updated:', transactionError);
        }
      }

      await refetchNotifications();
      setDepartmentTarget(null);
      toast({ title: 'Отдел изменён', description: 'Уведомление и PDF обновлены' });
    } catch (error) {
      toast({
        title: 'Не удалось изменить отдел',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const archiveNotification = async (archiveType: 'income' | 'expense') => {
    if (!archiveTarget) return;
    const year = getNotificationArchiveYear(archiveTarget);

    setSavingId(archiveTarget.id);
    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          metadata: {
            ...(archiveTarget.metadata || {}),
            archive_type: archiveType,
            archive_year: year,
            archived_at: new Date().toISOString(),
          },
        })
        .eq('id', archiveTarget.id);
      if (error) throw error;
      setArchiveTarget(null);
      await refetchNotifications();
      toast({
        title: 'Добавлено в архив',
        description: `${year} ${archiveType === 'income' ? 'доход' : 'расход'}`,
      });
    } catch (error) {
      toast({
        title: 'Ошибка архивации',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

  const getNotificationPdf = async (notification: Notification) => {
    let filePath = notification.metadata?.pdf_path as string | undefined;
    const transactionId = notification.metadata?.transaction_id as string | undefined;

    if (!filePath && transactionId) {
      const { data: files } = await supabase.storage
        .from('documents')
        .list(`${notification.user_id}/${transactionId}`);
      const pdfFile = files?.find(file => file.name.toLowerCase().endsWith('.pdf'));
      if (pdfFile) filePath = `${notification.user_id}/${transactionId}/${pdfFile.name}`;
    }
    if (!filePath) throw new Error('PDF не найден');

    const supabaseUrl = (supabase as any).supabaseUrl as string;
    const supabaseKey = (supabase as any).supabaseKey as string;
    const params = new URLSearchParams({
      action: 'sign',
      filePath,
      userId: notification.user_id,
    });
    const signResponse = await fetch(
      `${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } },
    );
    const signResult = await signResponse.json();
    if (!signResult.signedUrl) throw new Error(signResult.error || 'Не удалось получить PDF');

    const pdfResponse = await fetch(signResult.signedUrl);
    if (!pdfResponse.ok) throw new Error(`Ошибка загрузки PDF: HTTP ${pdfResponse.status}`);
    return {
      blob: await pdfResponse.blob(),
      name: filePath.split('/').pop() || `${notification.id}.pdf`,
    };
  };

  const removeFromArchive = async (notification: Notification) => {
    setSavingId(notification.id);
    try {
      const metadata = { ...(notification.metadata || {}) } as Record<string, unknown>;
      delete metadata.archive_type;
      delete metadata.archive_year;
      delete metadata.archived_at;

      const { error } = await supabase
        .from('notifications')
        .update({ metadata })
        .eq('id', notification.id);
      if (error) throw error;
      await refetchNotifications();
      toast({ title: 'PDF удалён из архива' });
    } catch (error) {
      toast({
        title: 'Ошибка удаления из архива',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSavingId(null);
    }
  };

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

    const otherRules = (existingRules || []).filter(rule => rule.department_name === departmentName);
    const primaryRule = otherRules[0];

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
    const duplicateTerms = duplicateRules.flatMap(rule => splitRuleTerms(String(rule.search_text || '')));
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

  const incomeNotifications = notifications.filter(isDepositNotification);
  const ruleRequests = notifications.filter(
    n => !isDepositNotification(n) && isRuleRequestNotification(n)
  );
  const archivedNotifications = getArchivedNotifications(notifications);
  const payoutNotifications = notifications.filter(
    n => !isDepositNotification(n) && !isRuleRequestNotification(n)
  );
  const withoutPhotos = payoutNotifications.filter(n => n.metadata?.images_skipped);
  const withPhotos = payoutNotifications.filter(n => !n.metadata?.images_skipped);
  const extensionNotifications = Array.from(
    new Map([...ruleRequests, ...archivedNotifications].map(notification => [notification.id, notification])).values(),
  ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const pushEnabled = pushPermission === 'granted' && hasPushSubscription;
  const pushActionLabel = pushEnabled ? 'Проверить push' : 'Включить push';
  const displayed =
    activeTab === 'income'
      ? incomeNotifications
      : activeTab === 'extension'
      ? ruleRequests
      : activeTab === 'all'
        ? withPhotos
        : withoutPhotos;
  const selectableNotifications = activeTab === 'extension' ? ruleRequests : displayed;
  const selectedInCurrentTab = selectableNotifications.filter(notification => selectedNotificationIds.has(notification.id));
  const areAllCurrentTabNotificationsSelected = selectableNotifications.length > 0
    && selectedInCurrentTab.length === selectableNotifications.length;

  const toggleSelectAllCurrentTab = () => {
    setSelectedNotificationIds(previous => {
      const next = new Set(previous);
      if (areAllCurrentTabNotificationsSelected) {
        selectableNotifications.forEach(notification => next.delete(notification.id));
      } else {
        selectableNotifications.forEach(notification => next.add(notification.id));
      }
      return next;
    });
  };
  const visibleExtensionIds = new Set(
    extensionNotifications.slice(0, visibleNotificationsLimit).map(notification => notification.id),
  );
  const visibleNotifications = activeTab === 'extension'
    ? ruleRequests.filter(notification => visibleExtensionIds.has(notification.id))
    : displayed.slice(0, visibleNotificationsLimit);
  const visibleArchivedNotifications = archivedNotifications.filter(notification => visibleExtensionIds.has(notification.id));
  const currentTabCount = activeTab === 'extension' ? extensionNotifications.length : displayed.length;
  const hasMoreNotifications = currentTabCount > visibleNotificationsLimit;
  const isNotificationsExpanded = visibleNotificationsLimit > NOTIFICATIONS_PAGE_SIZE;
  const incomeUnread = incomeNotifications.filter(n => !n.is_read).length;
  const noPhotosUnread = withoutPhotos.filter(n => !n.is_read).length;
  const ruleRequestsUnread = ruleRequests.filter(n => !n.is_read).length;
  const archiveGroups = visibleArchivedNotifications.reduce<Record<string, Notification[]>>((groups, notification) => {
    const type = notification.metadata?.archive_type === 'income' ? 'income' : 'expense';
    const year = Number(notification.metadata?.archive_year) || getNotificationArchiveYear(notification);
    const key = `${year}-${type}`;
    (groups[key] ||= []).push(notification);
    return groups;
  }, {});

  const downloadArchive = async (key: string, items: Notification[]) => {
    setDownloadingArchive(key);
    try {
      const zip = new JSZip();
      const [year, type] = key.split('-');
      const folderName = `${year} ${type === 'income' ? 'доход' : 'расход'}`;
      const folder = zip.folder(folderName);
      if (!folder) throw new Error('Не удалось создать архив');

      for (const notification of items) {
        const { blob, name } = await getNotificationPdf(notification);
        const monthFolder = folder.folder(getNotificationArchiveMonth(notification));
        monthFolder?.file(`${notification.id.slice(0, 8)}-${name}`, blob);
      }

      const archiveBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
      const url = URL.createObjectURL(archiveBlob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${folderName}.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: 'Ошибка создания архива',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setDownloadingArchive(null);
    }
  };

  return (
    <div className="animate-fade-in w-full min-w-0 max-w-full overflow-x-hidden">
      <div className="mb-4 flex min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
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
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 sm:hidden"
            onClick={enablePushNotifications}
            aria-label={pushActionLabel}
            title={pushActionLabel}
          >
            <BellRing className="h-5 w-5" />
          </Button>
          <Button variant="outline" size="sm" className="hidden sm:inline-flex" onClick={enablePushNotifications}>
            <BellRing className="h-4 w-4 mr-2" />
            {pushActionLabel}
          </Button>
          {selectableNotifications.length > 0 && (
            <Button variant="outline" size="sm" onClick={toggleSelectAllCurrentTab}>
              <CheckCheck className="h-4 w-4 mr-2" />
              {areAllCurrentTabNotificationsSelected ? 'Снять выбор' : 'Выбрать все'}
            </Button>
          )}
          {selectedNotifications.length > 0 && (
            <>
              <span className="w-full text-sm text-muted-foreground sm:w-auto">
                Выбрано: {selectedNotifications.length}
              </span>
              <Button variant="outline" size="sm" onClick={handleBulkMarkAsRead}>
                <CheckCheck className="h-4 w-4 mr-2" />
                Прочитано
              </Button>
              <Button variant="outline" size="sm" onClick={handleBulkMarkAsUnread}>
                <Mail className="h-4 w-4 mr-2" />
                Не прочитано
              </Button>
              <Button variant="outline" size="sm" onClick={handleCopySelected}>
                <Copy className="h-4 w-4 mr-2" />
                Копировать
              </Button>
              <Button variant="outline" size="sm" onClick={handleShareSelected}>
                <Share2 className="h-4 w-4 mr-2" />
                Передать
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
              >
                {isBulkDeleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Удалить
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4 mr-2" />
                Снять выбор
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-border">
        <button
          onClick={() => { setActiveTab('all'); setVisibleNotificationsLimit(NOTIFICATIONS_PAGE_SIZE); }}
          className={cn(
            'order-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Расходы
          {withPhotos.length > 0 && (
            <span className="ml-2 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
              {withPhotos.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('income'); setVisibleNotificationsLimit(NOTIFICATIONS_PAGE_SIZE); }}
          className={cn(
            'order-2 flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'income'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Banknote className="h-3.5 w-3.5" />
          Доходы
          {incomeNotifications.length > 0 && (
            <span className={cn(
              'ml-1 text-xs rounded-full px-1.5 py-0.5',
              incomeUnread > 0
                ? 'bg-green-500/20 text-green-500 font-semibold'
                : 'bg-muted text-muted-foreground'
            )}>
              {incomeNotifications.length}
            </span>
          )}
        </button>
        <button
          onClick={() => { setActiveTab('no_photos'); setVisibleNotificationsLimit(NOTIFICATIONS_PAGE_SIZE); }}
          className={cn(
            'order-1 flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
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
          onClick={() => { setActiveTab('extension'); setVisibleNotificationsLimit(NOTIFICATIONS_PAGE_SIZE); }}
          className={cn(
            'order-3 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
            activeTab === 'extension'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          Расширение
          {(ruleRequests.length + archivedNotifications.length) > 0 && (
            <span className={cn(
              'ml-2 text-xs rounded-full px-1.5 py-0.5',
              ruleRequestsUnread > 0
                ? 'bg-yellow-500/20 text-yellow-500 font-semibold'
                : 'bg-muted text-muted-foreground'
            )}>
              {ruleRequests.length + archivedNotifications.length}
            </span>
          )}
        </button>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          Загрузка...
        </div>
      ) : displayed.length === 0 && !(activeTab === 'extension' && extensionNotifications.length > 0) ? (
        <div className="p-12 text-center text-muted-foreground">
          <Mail className="h-16 w-16 mx-auto mb-4 opacity-30" />
          {activeTab === 'all' ? (
            <>
              <p className="text-lg">Нет уведомлений</p>
              <p className="text-sm mt-1">Здесь будут отображаться расходные ордера с фото</p>
            </>
          ) : activeTab === 'income' ? (
            <>
              <Banknote className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-lg">Нет уведомлений о доходах</p>
              <p className="text-sm mt-1">Здесь будут документы, отправленные через ссылку Dowód wpłaty</p>
            </>
          ) : activeTab === 'extension' ? (
            <>
              <p className="text-lg">Нет архивов и запросов расширения</p>
              <p className="text-sm mt-1">Добавьте PDF уведомления в архив доходов или расходов</p>
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
        <div className="min-w-0 max-w-full space-y-3 overflow-x-hidden">
          {activeTab === 'extension' && Object.entries(archiveGroups).map(([key, items]) => {
            const [year, type] = key.split('-');
            const label = `${year} ${type === 'income' ? 'доход' : 'расход'}`;
            const isExpanded = expandedArchiveGroups.has(key);
            return (
              <div key={key} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => setExpandedArchiveGroups(prev => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })}
                    aria-expanded={isExpanded}
                  >
                    <FolderArchive className="h-6 w-6 text-primary" />
                    <div>
                      <p className="font-semibold">{label}</p>
                      <p className="text-xs text-muted-foreground">PDF-файлов: {items.length}</p>
                    </div>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                  </button>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => downloadArchive(key, items)}
                      disabled={downloadingArchive === key}
                    >
                      {downloadingArchive === key
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      Скачать ZIP
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="mt-4 space-y-2 border-t border-border pt-3">
                    {items.map(notification => {
                      const issuedTo = notification.metadata?.issued_to as string | undefined;
                      const pdfPath = notification.metadata?.pdf_path as string | undefined;
                      return (
                        <div
                          key={notification.id}
                          className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {issuedTo || notification.title || 'PDF документ'}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {pdfPath?.split('/').pop() || format(new Date(notification.created_at), 'dd.MM.yyyy HH:mm')}
                              </p>
                            </div>
                          </div>
                          {notification.type === 'payout' && <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0 text-violet-500 hover:bg-violet-500/10 hover:text-violet-600"
                            onClick={() => {
                              setDepartmentTarget(notification);
                              setSelectedDepartment(
                                String(
                                  notification.metadata?.department_name
                                  || deptMap[notification.metadata?.transaction_id as string]
                                  || '',
                                ),
                              );
                            }}
                            disabled={savingId === notification.id}
                            aria-label="Изменить PDF"
                            title="Изменить PDF"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => removeFromArchive(notification)}
                            disabled={savingId === notification.id}
                            aria-label="Удалить PDF из архива"
                            title="Удалить PDF из архива"
                          >
                            {savingId === notification.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {visibleNotifications.map((notification) => (
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
              onArchive={activeTab === 'extension' ? undefined : setArchiveTarget}
              onChangeDepartment={(item) => {
                setDepartmentTarget(item);
                setSelectedDepartment(
                  String(
                    item.metadata?.department_name
                    || deptMap[item.metadata?.transaction_id as string]
                    || '',
                  ),
                );
              }}
              onEditDepositPdf={openDepositPdfEditor}
              savingId={savingId}
              swipedId={swipedId}
              onSwipe={setSwipedId}
              selected={selectedNotificationIds.has(notification.id)}
              onSelectedChange={toggleNotificationSelection}
            />
          ))}
          {currentTabCount > NOTIFICATIONS_PAGE_SIZE && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setVisibleNotificationsLimit(
                  isNotificationsExpanded
                    ? NOTIFICATIONS_PAGE_SIZE
                    : visibleNotificationsLimit + NOTIFICATIONS_PAGE_SIZE,
                )}
              >
                {hasMoreNotifications
                  ? `Показать ещё ${Math.min(NOTIFICATIONS_PAGE_SIZE, currentTabCount - visibleNotificationsLimit)}`
                  : 'Свернуть'}
              </Button>
            </div>
          )}
          <p className="text-xs text-center text-muted-foreground pt-2">
            Показано {Math.min(visibleNotificationsLimit, currentTabCount)} из {currentTabCount} уведомлений
          </p>
        </div>
      )}

      <Dialog
        open={Boolean(depositPdfTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDepositPdfTarget(null);
            setSelectedReceiptIndex('0');
            setCashierName('');
            setSignAllDepositReceipts(false);
            clearCashierSignature();
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{depositPdfTarget?.type === 'payout' ? 'Подписать расходный ордер' : 'Редактировать Dowód wpłaty'}</DialogTitle>
          </DialogHeader>
          {depositReceipts.length > 1 && (
            <div className="space-y-2">
              <Label>Квитанция</Label>
              <Select
                value={selectedReceiptIndex}
                onValueChange={(value) => {
                  setSelectedReceiptIndex(value);
                  setCashierName(String(depositReceipts[Number(value)]?.cashier || ''));
                  clearCashierSignature();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {depositReceipts.map((receipt, index) => (
                    <SelectItem key={index} value={String(index)}>
                      Квитанция {index + 1}: {String(receipt.issued_to || 'без имени')}
                      {receipt.amount ? ` - ${String(receipt.amount)} ${String(receipt.currency || '')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-3 rounded-md border p-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="deposit-cashier-name">Кассир - Имя Фамилия</Label>
              {depositReceipts.length > 1 && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="sign-all-deposit-receipts" className="cursor-pointer text-xs text-muted-foreground">
                    Подписать все квитанции
                  </Label>
                  <Switch
                    id="sign-all-deposit-receipts"
                    checked={signAllDepositReceipts}
                    onCheckedChange={setSignAllDepositReceipts}
                  />
                </div>
              )}
            </div>
            <Input
              id="deposit-cashier-name"
              value={cashierName}
              onChange={(event) => setCashierName(event.target.value)}
              placeholder="Введите имя и фамилию кассира"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label>Подпись кассира</Label>
              <Button type="button" variant="ghost" size="sm" onClick={clearCashierSignature}>
                Очистить
              </Button>
            </div>
            <canvas
              ref={cashierSignatureRef}
              width={700}
              height={180}
              className="h-36 w-full touch-none rounded-md border bg-white cursor-crosshair"
              onPointerDown={startCashierSignature}
              onPointerMove={drawCashierSignature}
              onPointerUp={() => { drawingCashierSignature.current = false; }}
              onPointerCancel={() => { drawingCashierSignature.current = false; }}
              onPointerLeave={() => { drawingCashierSignature.current = false; }}
            />
          </div>
          </div>
          <Button
            className="gap-2"
            onClick={saveDepositPdf}
            disabled={!cashierName.trim() || Boolean(savingId)}
          >
            {savingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
            Сохранить в PDF
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void saveDepositPdf(true)}
            disabled={Boolean(savingId)}
          >
            Отменить подпись
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(departmentTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDepartmentTarget(null);
            setSelectedDepartment('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Выберите отдел</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Отдел изменится в уведомлении, связанной транзакции и в сохранённом PDF-файле.
          </p>
          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите отдел" />
            </SelectTrigger>
            <SelectContent>
              {[...new Set(categories.map((category) => category.name))]
                .sort((a, b) => a.localeCompare(b, 'ru'))
                .map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            className="gap-2"
            onClick={saveNotificationDepartment}
            disabled={!selectedDepartment || Boolean(savingId)}
          >
            {savingId
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Building2 className="h-4 w-4" />}
            Сохранить и обновить PDF
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Добавить PDF в архив</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Выберите тип документа. Год будет определён по дате уведомления.
          </p>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="outline"
              className="h-12 border-green-500/50 text-green-600"
              onClick={() => archiveNotification('income')}
              disabled={Boolean(savingId)}
            >
              Доход
            </Button>
            <Button
              variant="outline"
              className="h-12 border-red-500/50 text-red-600"
              onClick={() => archiveNotification('expense')}
              disabled={Boolean(savingId)}
            >
              Расход
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
