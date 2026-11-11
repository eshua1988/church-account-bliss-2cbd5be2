import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Header, type SyncReport, type SyncReportItem } from '@/components/Header';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CategoryManager } from '@/components/CategoryManager';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { StatisticsTable } from '@/components/StatisticsTable';
import { PayoutGenerator } from '@/components/PayoutGenerator';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { useTranslation } from '@/contexts/LanguageContext';
import { Currency, CURRENCY_SYMBOLS, Transaction, TransactionType } from '@/types/transaction';
import { Loader2, ChevronDown, ChevronUp, Landmark, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { AppSidebar } from '@/components/AppSidebar';
import { GoogleSheetsSync, syncAllConfiguredGoogleSheetExports } from '@/components/GoogleSheetsSync';
import { TelegramBotSettings } from '@/components/TelegramBotSettings';
import { SharePayoutLink } from '@/components/SharePayoutLink';
import { ShareDepositLink } from '@/components/ShareDepositLink';
import { ShareTransactionsLink } from '@/components/ShareTransactionsLink';
import { ShareAnalyticsLink } from '@/components/ShareAnalyticsLink';
import { ShareProtocolsLink } from '@/components/ShareProtocolsLink';
import { PublicLinkHeaderActions } from '@/components/PublicLinkHeaderActions';
import { NotificationsPage } from '@/components/NotificationsPage';
import { BankingPage } from '@/components/BankingPage';
import { TelegramMenuPage } from '@/components/TelegramMenuPage';
import { RegistrationBuilder } from '@/components/RegistrationBuilder';
import { HeaderBrandingSettings } from '@/components/HeaderBrandingSettings';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotifications } from '@/hooks/useNotifications';
import { CloudStorageSettings } from '@/components/CloudStorageSettings';
import { syncNotificationArchivesToCloud } from '@/lib/cloudArchiveSync';
import { LinksPage } from '@/components/LinksPage';
import { RemindersPage } from '@/components/RemindersPage';
import { PdfArchiveStatistics } from '@/components/PdfArchiveStatistics';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const SYNC_REPORT_STORAGE_KEY = 'church-sync-report-v1';
const SYNC_QUEUE_STORAGE_KEY = 'church-sync-queue-v1';
const SYNC_QUEUE_MAX_AGE_MS = 10 * 60 * 1000;

const loadSyncReport = (): SyncReport | null => {
  try {
    const raw = localStorage.getItem(SYNC_REPORT_STORAGE_KEY);
    if (!raw) return null;
    const report = JSON.parse(raw) as SyncReport;
    return report?.completedAt && Array.isArray(report.items) ? report : null;
  } catch {
    return null;
  }
};

const Index = () => {
  const { t, getDateLocale } = useTranslation();
  const { user, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'statistics' | 'payout' | 'settings' | 'notifications' | 'links' | 'reminders'>('statistics');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openSettings, setOpenSettings] = useState<Record<string, boolean>>({});
  const toggleSetting = (key: string) => setOpenSettings(prev => ({ ...prev, [key]: !prev[key] }));

  const { toast } = useToast();
  const isMobile = useIsMobile();

  // Swipe gesture for mobile sidebar
  useSwipeGesture({
    onSwipeRight: () => {
      if (isMobile) {
        setMobileMenuOpen(true);
      }
    },
    onSwipeLeft: () => {
      if (isMobile && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    },
  });
  
  const {
    transactions,
    loading: transactionsLoading,
    loadingMore: transactionsLoadingMore,
    totalCount: transactionCount,
    hasMore: hasMoreTransactions,
    loadMore: loadMoreTransactions,
    getAllTransactions,
    availableCurrencies,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    refetch: refetchTransactions,
    getBalanceByCurrency,
    getTransactionsByCategory,
    getMonthlyData,
  } = useSupabaseTransactions();

  const {
    categories,
    loading: categoriesLoading,
    addCategory,
    deleteCategory,
    updateCategory,
    reorderCategories,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
  } = useSupabaseCategories();

  const expenseCategories = getExpenseCategories();

  const { notifications, refetch: refetchNotifications } = useNotifications();
  
  const [isBankSyncing, setIsBankSyncing] = useState(false);
  const [isConfiguredExportsSyncing, setIsConfiguredExportsSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(loadSyncReport);
  const [retryingSyncItemIds, setRetryingSyncItemIds] = useState<string[]>([]);
  const resumedSyncRef = useRef(false);
  const profileSignatureCanvas = useRef<HTMLCanvasElement>(null);
  const profileDrawing = useRef(false);
  const [profileName, setProfileName] = useState('');
  const [profileSignature, setProfileSignature] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const applyProfile = useCallback((metadata?: Record<string, unknown> | null) => {
    setProfileName(String(metadata?.display_name || user?.user_metadata?.display_name || ''));
    setProfileSignature(String(metadata?.signature || user?.user_metadata?.signature || ''));
  }, [user?.user_metadata]);

  useEffect(() => {
    if (!user) {
      applyProfile(null);
      return;
    }
    let active = true;
    const loadProfile = async () => {
      // getUser() reads the latest account metadata from Supabase, while the
      // session object may still contain metadata from another device's old JWT.
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error) {
        console.warn('Could not load user profile:', error);
        applyProfile(null);
        return;
      }
      applyProfile(data.user?.user_metadata);
    };
    void loadProfile();
    window.addEventListener('focus', loadProfile);

    return () => {
      active = false;
      window.removeEventListener('focus', loadProfile);
    };
  }, [user?.id, applyProfile]);

  const profilePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) };
  };
  const startProfileSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    profileDrawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const point = profilePoint(event);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.beginPath();
    context.moveTo(point.x, point.y);
  };
  const drawProfileSignature = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!profileDrawing.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext('2d');
    if (!context) return;
    const point = profilePoint(event);
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    context.lineTo(point.x, point.y);
    context.stroke();
    setProfileSignature(canvas.toDataURL('image/png'));
  };
  const clearProfileSignature = () => {
    const canvas = profileSignatureCanvas.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setProfileSignature('');
  };
  const saveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const displayName = profileName.trim() || user.email || 'Пользователь';
      const { error } = await supabase.auth.updateUser({ data: { ...user.user_metadata, display_name: displayName, signature: profileSignature || null } });
      if (error) throw error;
      toast({ title: 'Профиль сохранён', description: 'Имя и подпись обновлены.' });
    } catch (error) {
      toast({ title: 'Не удалось сохранить профиль', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setSavingProfile(false);
    }
  };

  useEffect(() => {
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const loadRemoteReport = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await (supabase as any)
        .from('sync_reports')
        .select('completed_at, items')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data && active) {
        const report = { completedAt: data.completed_at, items: data.items as SyncReportItem[] };
        setSyncReport(report);
        localStorage.setItem(SYNC_REPORT_STORAGE_KEY, JSON.stringify(report));
      }
      channel = supabase
        .channel(`sync-reports-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sync_reports', filter: `user_id=eq.${user.id}` }, payload => {
          const row = payload.new as { completed_at: string; items: SyncReportItem[] };
          const report = { completedAt: row.completed_at, items: row.items };
          setSyncReport(report);
          localStorage.setItem(SYNC_REPORT_STORAGE_KEY, JSON.stringify(report));
        })
        .subscribe();
    };
    void loadRemoteReport();
    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);

  const handleBankSync = useCallback(async (): Promise<SyncReportItem> => {
    try {
      setIsBankSyncing(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Войдите в систему повторно');
      const { data: json, error } = await supabase.functions.invoke<any>('banking-sync', {
        body: { user_id: session.user.id },
      });

      if (error) {
        const response = (error as any).context;
        const details = await response?.json?.().catch(() => null);
        throw new Error(details?.error || error.message);
      }

      if (json.imported > 0) {
        toast({ title: 'Банк синхронизирован', description: `Добавлено ${json.imported} новых транзакций` });
      }
      await refetchTransactions();
      return {
        id: 'bank',
        title: 'Импорт из банка',
        status: 'success',
        details: [
          `Операций в банке: ${Number(json.bank_total ?? json.total ?? 0).toLocaleString('ru-RU')}; добавлено: ${Number(json.imported ?? 0).toLocaleString('ru-RU')}`,
          `Отсутствуют в приложении: ${Number(json.missing ?? 0).toLocaleString('ru-RU')}; лишних в приложении: ${Number(json.extra ?? 0).toLocaleString('ru-RU')}`,
          ...(Number(json.removed_extra ?? 0) > 0 ? [`Удалено устаревших банковских операций: ${Number(json.removed_extra).toLocaleString('ru-RU')}`] : []),
        ],
      };
    } catch (e) {
      toast({ title: 'Ошибка синхр. банка', description: String(e), variant: 'destructive' });
      return { id: 'bank', title: 'Импорт из банка', status: 'error', details: [e instanceof Error ? e.message : String(e)] };
    } finally {
      setIsBankSyncing(false);
    }
  }, [refetchTransactions, toast]);

  const isSyncing = isBankSyncing || isConfiguredExportsSyncing;

  const handleSync = useCallback(async () => {
    setIsConfiguredExportsSyncing(true);
    const startedAt = new Date().toISOString();
    // The browser keeps running while the window is minimised. If it is closed
    // or restarted, this marker resumes the full sync after the next sign-in.
    localStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify({ requestedAt: startedAt }));
    const updateLiveItem = (item: SyncReportItem) => {
      setSyncReport(current => {
        const items = current?.completedAt === startedAt ? [...current.items] : [];
        const index = items.findIndex(candidate => candidate.id === item.id);
        if (index === -1) items.push(item);
        else items[index] = item;
        return { completedAt: startedAt, items };
      });
    };
    updateLiveItem({ id: 'bank', title: 'Импорт из банка', status: 'queued', details: ['Ожидает запуска'] });
    updateLiveItem({ id: 'cloud', title: 'Облачные PDF-архивы', status: 'queued', details: ['Ожидает запуска'] });
    try {
      // Each integration is independent: one failed destination must never
      // cancel exports to the others.
      const configuredExportsTask = syncAllConfiguredGoogleSheetExports(
        transactions,
        expenseCategories,
        getAllTransactions,
        updateLiveItem,
      );
      const bankTask = (async () => {
        updateLiveItem({ id: 'bank', title: 'Импорт из банка', status: 'running', details: ['Синхронизация выполняется'] });
        const item = await handleBankSync();
        updateLiveItem(item);
        return item;
      })();
      const cloudTask = (async () => {
        updateLiveItem({ id: 'cloud', title: 'Облачные PDF-архивы', status: 'running', details: ['Синхронизация выполняется'] });
        return await Promise.race([
          syncNotificationArchivesToCloud(notifications),
          new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('Превышено время ожидания облачной синхронизации')), 120_000)),
        ]);
      })();
      const [configuredExports, bank, cloud] = await Promise.allSettled([
        configuredExportsTask,
        bankTask,
        cloudTask,
      ]);
      const reportItems: SyncReportItem[] = [];

      if (configuredExports.status === 'fulfilled') {
        const configuredExportsResult = configuredExports.value;
        reportItems.push(...(configuredExportsResult.configured > 0
          ? configuredExportsResult.items
          : [{ id: 'sheets', title: 'Экспорт в Google Sheets', status: 'skipped' as const, details: ['Нет настроенных экспортов'] }]));
        if (configuredExportsResult.configured > 0) {
          toast({
            title: configuredExportsResult.failed > 0 ? 'Не все экспорты Google Sheets завершены' : 'Экспорты Google Sheets завершены',
            description: `Готово: ${configuredExportsResult.completed} из ${configuredExportsResult.configured}`,
            variant: configuredExportsResult.failed > 0 ? 'destructive' : 'default',
          });
        }
        if (configuredExportsResult.errors.length > 0) {
          toast({ title: 'Ошибка экспорта Google Sheets', description: configuredExportsResult.errors.join('; '), variant: 'destructive' });
        }
      } else {
        reportItems.push({ id: 'sheets', title: 'Экспорт в Google Sheets', status: 'error', details: [String(configuredExports.reason)] });
        toast({ title: 'Ошибка экспорта Google Sheets', description: String(configuredExports.reason), variant: 'destructive' });
      }

      reportItems.push(bank.status === 'fulfilled'
        ? bank.value
        : { id: 'bank', title: 'Импорт из банка', status: 'error', details: [String(bank.reason)] });

      if (cloud.status === 'fulfilled') {
        const cloudResult = cloud.value;
        const cloudItem: SyncReportItem = cloudResult.skipped
          ? { id: 'cloud', title: 'Облачные PDF-архивы', status: cloudResult.errors.length > 0 ? 'error' : 'skipped', details: [cloudResult.errors.length > 0 ? cloudResult.errors.join('; ') : 'Нет подключённых облачных хранилищ'] }
          : { id: 'cloud', title: 'Облачные PDF-архивы', status: cloudResult.errors.length > 0 ? 'error' : 'success', details: [`Архивов обработано: ${cloudResult.archives}; файлов загружено: ${cloudResult.uploaded}`, ...(cloudResult.pendingBatches ? [`Осталось пакетов: ${cloudResult.pendingBatches}`] : []), ...cloudResult.errors] };
        reportItems.push(cloudItem);
        updateLiveItem(cloudItem);
        if (cloudResult.uploaded > 0) {
          toast({ title: 'Облачные архивы обновлены', description: `Загружено файлов: ${cloudResult.uploaded}` });
        }
        if (cloudResult.errors.length > 0) {
          toast({ title: 'Ошибка синхронизации облака', description: cloudResult.errors.join('; '), variant: 'destructive' });
        }
      } else {
        const cloudItem: SyncReportItem = { id: 'cloud', title: 'Облачные PDF-архивы', status: 'error', details: [String(cloud.reason)] };
        reportItems.push(cloudItem);
        updateLiveItem(cloudItem);
        toast({ title: 'Ошибка синхронизации облака', description: String(cloud.reason), variant: 'destructive' });
      }

      const nextReport: SyncReport = { completedAt: new Date().toISOString(), items: reportItems };
      setSyncReport(nextReport);
      localStorage.setItem(SYNC_REPORT_STORAGE_KEY, JSON.stringify(nextReport));
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error } = await (supabase as any).from('sync_reports').insert({
          user_id: user.id,
          completed_at: nextReport.completedAt,
          trigger_source: 'manual',
          items: nextReport.items,
        });
        if (error) console.error('Failed to save shared sync report:', error);
      }
    } finally {
      setIsConfiguredExportsSyncing(false);
      localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
    }
  }, [handleBankSync, notifications, toast, transactions, expenseCategories, getAllTransactions]);

  const updateSyncReportItem = useCallback((item: SyncReportItem) => {
    setSyncReport(current => {
      const items = [...(current?.items || [])];
      const index = items.findIndex(candidate => candidate.id === item.id);
      if (index === -1) items.push(item);
      else items[index] = item;
      const next = { completedAt: new Date().toISOString(), items };
      localStorage.setItem(SYNC_REPORT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleRetrySyncItem = useCallback(async (id: string) => {
    if (isSyncing || retryingSyncItemIds.includes(id)) return;
    setRetryingSyncItemIds(current => [...current, id]);
    localStorage.setItem(SYNC_QUEUE_STORAGE_KEY, JSON.stringify({ requestedAt: new Date().toISOString(), retryItemId: id }));
    updateSyncReportItem({ id, title: syncReport?.items.find(item => item.id === id)?.title || 'Синхронизация', status: 'running', details: ['Синхронизация выполняется'] });
    try {
      if (id === 'bank') {
        updateSyncReportItem(await handleBankSync());
        return;
      }
      if (id === 'cloud') {
        const result = await syncNotificationArchivesToCloud(notifications);
        updateSyncReportItem(result.skipped
          ? { id, title: 'Облачные PDF-архивы', status: result.errors.length ? 'error' : 'skipped', details: [result.errors.length ? result.errors.join('; ') : 'Нет подключённых облачных хранилищ'] }
          : { id, title: 'Облачные PDF-архивы', status: result.errors.length ? 'error' : 'success', details: [`Архивов обработано: ${result.archives}; файлов загружено: ${result.uploaded}`, ...(result.pendingBatches ? [`Осталось пакетов: ${result.pendingBatches}`] : []), ...result.errors] });
        return;
      }
      if (id.startsWith('sheets-')) {
        const exportId = id.slice('sheets-'.length);
        const result = await syncAllConfiguredGoogleSheetExports(transactions, expenseCategories, getAllTransactions, updateSyncReportItem, [exportId]);
        updateSyncReportItem(result.items?.[0] || { id, title: 'Google Sheets', status: 'skipped', details: ['Экспорт больше не настроен'] });
      }
    } catch (error) {
      updateSyncReportItem({ id, title: syncReport?.items.find(item => item.id === id)?.title || 'Синхронизация', status: 'error', details: [error instanceof Error ? error.message : String(error)] });
    } finally {
      setRetryingSyncItemIds(current => current.filter(item => item !== id));
      localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
    }
  }, [expenseCategories, getAllTransactions, handleBankSync, isSyncing, notifications, retryingSyncItemIds, syncReport?.items, transactions, updateSyncReportItem]);

  useEffect(() => {
    if (transactionsLoading || categoriesLoading || resumedSyncRef.current) return;
    try {
      const queued = localStorage.getItem(SYNC_QUEUE_STORAGE_KEY);
      if (!queued) return;
      const requestedAt = JSON.parse(queued)?.requestedAt;
      if (!requestedAt || Date.now() - new Date(requestedAt).getTime() > SYNC_QUEUE_MAX_AGE_MS) {
        localStorage.removeItem(SYNC_QUEUE_STORAGE_KEY);
        return;
      }
      resumedSyncRef.current = true;
      void handleSync();
    } catch {
      // Storage is optional; a manual synchronization remains available.
    }
  }, [handleSync, transactionsLoading, categoriesLoading]);

  const incomeByCategory = getTransactionsByCategory('income');
  const expenseByCategory = getTransactionsByCategory('expense');

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    try {
      await addTransaction(transaction);
      toast({
        title: transaction.type === 'income' ? t('incomeAdded') : t('expenseAdded'),
        description: `${transaction.amount.toLocaleString(getDateLocale())} ${CURRENCY_SYMBOLS[transaction.currency]}`,
      });
      // Auto-sync will be triggered by useEffect watching transactions.length
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось добавить транзакцию',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    try {
      await deleteTransaction(id);
      toast({ title: t('transactionDeleted'), variant: 'destructive' });
      // Auto-sync will be triggered by useEffect watching transactions.length

      // Unlink transaction from notification if it still exists
      try {
        const { data: notif } = await supabase
          .from('notifications')
          .select('id, metadata')
          .eq('metadata->>transaction_id', id)
          .maybeSingle();
        if (notif && notif.metadata) {
          const newMeta = { ...(notif.metadata as Record<string, unknown>) };
          delete newMeta.transaction_id;
          await supabase
            .from('notifications')
            .update({ metadata: newMeta })
            .eq('id', notif.id);
        }
      } catch {
        // Notification unlink is best-effort, ignore errors
      }
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить транзакцию',
        variant: 'destructive',
      });
    }
  };

  const handleAddCategory = async (name: string, type: 'income' | 'expense') => {
    try {
      await addCategory(name, type);
      toast({ title: t('categoryAdded'), description: name });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось добавить категорию',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      const categoryName = getCategoryName(id);
      await deleteCategory(id);
      toast({ title: t('categoryDeleted'), description: categoryName, variant: 'destructive' });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить категорию',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateCategory = async (id: string, name: string) => {
    try {
      await updateCategory(id, name);
      toast({ title: t('categoryUpdated'), description: name });
    } catch (error) {
      toast({
        title: 'Ошибка',
        description: 'Не удалось обновить категорию',
        variant: 'destructive',
      });
    }
  };

  const handleReorderCategories = (type: TransactionType, fromIndex: number, toIndex: number) => {
    reorderCategories(type, fromIndex, toIndex);
  };

  const handleLinkNotification = async (transactionId: string, notificationId: string) => {
    const notification = notifications.find(n => n.id === notificationId);
    if (!notification) return;
    const meta = notification.metadata;
    if (!meta) return;

    try {
      // Find category by department_name or category_id from notification
      const cats = getExpenseCategories();
      const matchedCat = meta.category_id
        ? cats.find(c => c.id === (meta.category_id as string))
        : meta.department_name
          ? cats.find(c => c.name === meta.department_name)
          : undefined;

      const updates: Partial<Transaction> = {};
      if (matchedCat) {
        updates.category = matchedCat.id as any;
        updates.departmentName = matchedCat.name;
      } else if (meta.department_name) {
        updates.departmentName = meta.department_name;
      }
      if (meta.issued_to) updates.issuedTo = meta.issued_to;
      if (meta.decision_number) updates.decisionNumber = meta.decision_number as string;
      if (meta.amount_in_words) updates.amountInWords = meta.amount_in_words as string;

      const descParts = [meta.issued_to, meta.basis as string].filter(Boolean);
      if (descParts.length > 0) updates.description = descParts.join(' — ');

      if (Object.keys(updates).length > 0) {
        await updateTransaction(transactionId, updates);
      }

      // Write transaction_id back to notification metadata
      // First, unlink any previously linked notification for this transaction
      const prevLinked = notifications.find(n => n.metadata?.transaction_id === transactionId && n.id !== notificationId);
      if (prevLinked && prevLinked.metadata) {
        const { transaction_id, ...restMeta } = prevLinked.metadata;
        await supabase
          .from('notifications')
          .update({ metadata: restMeta })
          .eq('id', prevLinked.id);
      }

      await supabase
        .from('notifications')
        .update({ metadata: { ...meta, transaction_id: transactionId } })
        .eq('id', notificationId);

      refetchNotifications();
      toast({ title: 'Уведомление привязано', description: meta.issued_to || notification.title });
    } catch (error) {
      toast({ title: 'Ошибка привязки', variant: 'destructive' });
    }
  };

  const handleUnlinkNotification = async (transactionId: string) => {
    try {
      const linked = notifications.find(n => n.metadata?.transaction_id === transactionId);
      if (linked && linked.metadata) {
        const { transaction_id, ...restMeta } = linked.metadata;
        await supabase
          .from('notifications')
          .update({ metadata: restMeta })
          .eq('id', linked.id);
      }
      refetchNotifications();
      toast({ title: 'Уведомление отвязано' });
    } catch (error) {
      toast({ title: 'Ошибка отвязки', variant: 'destructive' });
    }
  };

  const isLoading = transactionsLoading || categoriesLoading;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex flex-col">
      <Header 
        collapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        onAddTransaction={handleAddTransaction}
        onSync={handleSync}
        isSyncing={isSyncing}
        syncReport={syncReport}
        onRetrySyncItem={handleRetrySyncItem}
        retryingSyncItemIds={retryingSyncItemIds}
        incomeCategories={getIncomeCategories()}
        expenseCategories={getExpenseCategories()}
      />
      
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <AppSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileMenuOpen}
          onMobileOpenChange={setMobileMenuOpen}
        />
        
        <div className="flex-1 min-h-0 min-w-0 overflow-auto">
        
        <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">

          {/* Statistics Tab */}
          {activeTab === 'statistics' && (
            <div className="animate-fade-in">
              <Tabs defaultValue="online" className="w-full space-y-4">
                <TabsList className="h-auto gap-1 p-1">
                  <TabsTrigger value="online" className="gap-2 px-5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Банк</TabsTrigger>
                  <TabsTrigger value="pdf" className="gap-2 px-5"><span className="h-2 w-2 rounded-full bg-amber-500" />PDF</TabsTrigger>
                </TabsList>
                <TabsContent value="online" className="mt-0">
              <div className="mb-4 flex items-center gap-3 rounded-xl border bg-card p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Landmark className="h-5 w-5" /></div>
                <div className="flex flex-wrap items-baseline gap-x-2"><h2 className="font-semibold">Банк</h2><p className="text-sm text-muted-foreground">— Транзакции сохранены из Банка онлайн.</p></div>
              </div>
              <Tabs defaultValue="balance" className="w-full">
                <div className="sticky top-0 z-30 -mx-3 sm:-mx-4 mb-4 px-3 sm:px-4 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 border-b border-border/60">
                  <TabsList className="flex-wrap h-auto gap-1 p-1">
                    <TabsTrigger value="balance" className="text-xs sm:text-sm">{t('balanceByCurrency')}</TabsTrigger>
                    <TabsTrigger value="table" className="text-xs sm:text-sm">{t('transactionsTable')}</TabsTrigger>
                    <TabsTrigger value="calculator" className="text-xs sm:text-sm">Калькулятор</TabsTrigger>
                  </TabsList>
                </div>
                <TabsContent value="calculator">
                  <StatisticsTable
                    transactions={transactions}
                    getCategoryName={getCategoryName}
                    selectedCurrency={null}
                    categories={categories}
                    calculatorMode
                  />
                </TabsContent>
                <TabsContent value="table">
                  <div>
                    <div>
                      <StatisticsTable 
                        transactions={transactions} 
                        totalCount={transactionCount}
                        hasMore={hasMoreTransactions}
                        loadingMore={transactionsLoadingMore}
                        onLoadMore={loadMoreTransactions}
                        getCategoryName={getCategoryName} 
                        onDelete={handleDeleteTransaction}
                        onUpdate={async (id, updates) => {
                          try {
                            await updateTransaction(id, updates);
                          } catch (error) {
                            toast({ title: 'Ошибка сохранения', variant: 'destructive' });
                          }
                        }}
                        categories={categories}
                        notifications={notifications}
                        onLinkNotification={handleLinkNotification}
                        onUnlinkNotification={handleUnlinkNotification}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="balance">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {((availableCurrencies.length > 0
                      ? availableCurrencies
                      : [...new Set(transactions.map(tx => tx.currency))]) as Currency[])
                      .map((currency, index) => {
                        const currencyBalance = getBalanceByCurrency(currency);
                        return (
                          <CurrencyBalanceCard
                            key={currency}
                            currency={currency}
                            income={currencyBalance.income}
                            expense={currencyBalance.expense}
                            balance={currencyBalance.balance}
                            delay={index * 100}
                            transactions={transactions}
                            getCategoryName={getCategoryName}
                          />
                        );
                      })}
                  </div>
                  {transactionCount === 0 && (
                    <p className="text-muted-foreground text-center py-8">{t('noTransactions')}</p>
                  )}
                </TabsContent>
              </Tabs>
                </TabsContent>
                <TabsContent value="pdf" className="mt-0">
                  <PdfArchiveStatistics categories={categories} getCategoryName={getCategoryName} />
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Payout Generator Tab */}
          {activeTab === 'payout' && (
            <div className="animate-fade-in space-y-6">
              <PayoutGenerator />
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="animate-fade-in space-y-3">
              {user && (
                <div className="rounded-lg bg-card p-4 shadow-card sm:p-5">
                  <div className="mb-5 flex items-center gap-3">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="gradient-primary text-primary-foreground">
                        {(profileName || user.email || 'П').split(/\s|@/).filter(Boolean).slice(0, 2).map(value => value[0]).join('').toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-base sm:text-lg">{profileName || 'Пользователь'}</h4>
                      <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-auto shrink-0"
                      onClick={() => void signOut()}
                    >
                      <LogOut className="h-4 w-4" />
                      Выйти из аккаунта
                    </Button>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="profile-name">Имя и фамилия</Label>
                      <Input
                        id="profile-name"
                        value={profileName}
                        onChange={(event) => setProfileName(event.target.value)}
                        placeholder="Введите имя и фамилию"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <Label>Подпись</Label>
                        <Button type="button" variant="ghost" size="sm" onClick={clearProfileSignature}>
                          Очистить
                        </Button>
                      </div>
                      <canvas
                        ref={profileSignatureCanvas}
                        width={700}
                        height={220}
                        className="h-36 w-full touch-none rounded-md border bg-white"
                        onPointerDown={startProfileSignature}
                        onPointerMove={drawProfileSignature}
                        onPointerUp={() => { profileDrawing.current = false; }}
                        onPointerCancel={() => { profileDrawing.current = false; }}
                        onPointerLeave={() => { profileDrawing.current = false; }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Нарисуйте подпись мышью или пальцем — она будет сохранена в профиле.
                      </p>
                    </div>
                  </div>

                  {profileSignature && (
                    <div className="mt-4">
                      <p className="mb-2 text-sm text-muted-foreground">Сохранённая подпись</p>
                      <img src={profileSignature} alt="Подпись пользователя" className="h-20 max-w-full rounded-md border bg-white object-contain" />
                    </div>
                  )}

                  <div className="mt-5 flex justify-end">
                    <Button type="button" onClick={() => void saveProfile()} disabled={savingProfile}>
                      {savingProfile ? 'Сохранение…' : 'Сохранить профиль'}
                    </Button>
                  </div>
                </div>
              )}
              {/* Extension */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('extension')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('settingsExtension')}</h4>
                  {openSettings.extension ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.extension && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <HeaderBrandingSettings />
                  </div>
                )}
              </div>

              {/* Categories */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('categories')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('categoryManagement')}</h4>
                  {openSettings.categories ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.categories && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <CategoryManager 
                      categories={categories} 
                      onAdd={handleAddCategory} 
                      onDelete={handleDeleteCategory} 
                      onUpdate={handleUpdateCategory}
                      onReorder={handleReorderCategories}
                      transactions={transactions}
                      onBulkUpdateDepartment={async (ids, dept) => {
                        for (const id of ids) {
                          await updateTransaction(id, { departmentName: dept });
                        }
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Google Sheets */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('sheets')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">Google Sheets</h4>
                  {openSettings.sheets ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.sheets && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <GoogleSheetsSync 
                      transactions={transactions} 
                      getAllTransactions={getAllTransactions}
                      getCategoryName={getCategoryName} 
                      onDeleteTransaction={deleteTransaction}
                      expenseCategories={expenseCategories}
                    />
                  </div>
                )}
              </div>

              {/* Cloud archives */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('cloud')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('cloudStorage')}</h4>
                  {openSettings.cloud ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.cloud && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <CloudStorageSettings />
                  </div>
                )}
              </div>

              {/* Share Payout Link */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('share')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('shareForm')}</h4>
                  {openSettings.share ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.share && (
                  <div className="space-y-3 px-4 pb-4 sm:px-6 sm:pb-6">
                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button type="button" onClick={() => toggleSetting('sharePayout')} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary">
                          <span className="font-semibold">{t('payoutOrder')}</span>
                          {openSettings.sharePayout ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                        {!openSettings.sharePayout && <PublicLinkHeaderActions kind="payout" />}
                      </div>
                      {openSettings.sharePayout && <div className="border-t p-3 sm:p-4"><SharePayoutLink /></div>}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button type="button" onClick={() => toggleSetting('shareDeposit')} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary">
                          <span className="font-semibold">{t('depositReceipt')}</span>
                          {openSettings.shareDeposit ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                        {!openSettings.shareDeposit && <PublicLinkHeaderActions kind="deposit" />}
                      </div>
                      {openSettings.shareDeposit && <div className="border-t p-3 sm:p-4"><ShareDepositLink /></div>}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button type="button" onClick={() => toggleSetting('shareTransactions')} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary">
                          <span className="font-semibold">{t('transactionsTable')}</span>
                          {openSettings.shareTransactions ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                        {!openSettings.shareTransactions && <PublicLinkHeaderActions kind="transactions" />}
                      </div>
                      {openSettings.shareTransactions && <div className="border-t p-3 sm:p-4"><ShareTransactionsLink /></div>}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button type="button" onClick={() => toggleSetting('shareAnalytics')} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary">
                          <span className="font-semibold">Аналитика</span>
                          {openSettings.shareAnalytics ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                        {!openSettings.shareAnalytics && <PublicLinkHeaderActions kind="analytics" />}
                      </div>
                      {openSettings.shareAnalytics && <div className="border-t p-3 sm:p-4"><ShareAnalyticsLink /></div>}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-border">
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button type="button" onClick={() => toggleSetting('shareProtocols')} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left hover:text-primary">
                          <span className="font-semibold">Протоколы</span>
                          {openSettings.shareProtocols ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </button>
                        {!openSettings.shareProtocols && <PublicLinkHeaderActions kind="protocols" />}
                      </div>
                      {openSettings.shareProtocols && <div className="border-t p-3 sm:p-4"><ShareProtocolsLink /></div>}
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram Bot */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('telegram')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('telegramBot')}</h4>
                  {openSettings.telegram ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.telegram && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-6">
                    <TelegramBotSettings />
                    <Separator />
                    <TelegramMenuPage />
                  </div>
                )}
              </div>

              {/* Event registration */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('registration')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">Регистрация</h4>
                  {openSettings.registration ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.registration && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <RegistrationBuilder />
                  </div>
                )}
              </div>

              {/* Banking */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('banking')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">{t('polishBanks')}</h4>
                  {openSettings.banking ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.banking && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6">
                    <BankingPage />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <NotificationsPage />
          )}

          {activeTab === 'links' && <LinksPage onSyncSheetExport={async exportId => {
            const result = await syncAllConfiguredGoogleSheetExports(
              transactions,
              expenseCategories,
              getAllTransactions,
              undefined,
              [exportId],
            );
            if (result.failed > 0) throw new Error(result.errors.join('; '));
          }} />}

          {activeTab === 'reminders' && <RemindersPage />}

        </main>
        </div>
      </div>
    </div>
  );
};

export default Index;
