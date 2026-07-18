import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CategoryManager } from '@/components/CategoryManager';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { StatisticsTable } from '@/components/StatisticsTable';
import { PayoutGenerator } from '@/components/PayoutGenerator';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { useTranslation } from '@/contexts/LanguageContext';
import { Currency, CURRENCY_SYMBOLS, Transaction, TransactionType } from '@/types/transaction';
import { Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { AppSidebar } from '@/components/AppSidebar';
import { GoogleSheetsSync } from '@/components/GoogleSheetsSync';
import { TelegramBotSettings } from '@/components/TelegramBotSettings';
import { SharePayoutLink } from '@/components/SharePayoutLink';
import { ShareTransactionsLink } from '@/components/ShareTransactionsLink';
import { NotificationsPage } from '@/components/NotificationsPage';
import { BankingPage } from '@/components/BankingPage';
import { TelegramMenuPage } from '@/components/TelegramMenuPage';
import { HeaderBrandingSettings } from '@/components/HeaderBrandingSettings';
import { useGoogleSheetsSync } from '@/hooks/useGoogleSheetsSync';
import { useSwipeGesture } from '@/hooks/useSwipeGesture';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotifications } from '@/hooks/useNotifications';
import { CloudStorageSettings } from '@/components/CloudStorageSettings';
import { syncNotificationArchivesToCloud } from '@/lib/cloudArchiveSync';

const Index = () => {
  const { t, getDateLocale } = useTranslation();
  const [activeTab, setActiveTab] = useState<'statistics' | 'payout' | 'settings' | 'notifications'>('statistics');
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
  
  const {
    isSyncing: isSheetSyncing,
    handleSync: handleSheetSync,
    spreadsheetId,
  } = useGoogleSheetsSync({
    transactions,
    onDeleteTransaction: deleteTransaction,
    expenseCategories,
  });

  const [isBankSyncing, setIsBankSyncing] = useState(false);

  const handleBankSync = useCallback(async () => {
    try {
      setIsBankSyncing(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const accessToken = session.access_token || supabaseKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/banking-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ user_id: session.user.id }),
      });

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

      if (!res.ok) {
        toast({ title: 'Ошибка синхр. банка', description: json?.error || `HTTP ${res.status}`, variant: 'destructive' });
        return;
      }

      if (json.imported > 0) {
        toast({ title: 'Банк синхронизирован', description: `Добавлено ${json.imported} новых транзакций` });
      }
      await refetchTransactions();
    } catch (e) {
      toast({ title: 'Ошибка синхр. банка', description: String(e), variant: 'destructive' });
    } finally {
      setIsBankSyncing(false);
    }
  }, [refetchTransactions, toast]);

  const isSyncing = isSheetSyncing || isBankSyncing;

  const handleSync = useCallback(async () => {
    const [, , cloudResult] = await Promise.all([
      handleSheetSync(),
      handleBankSync(),
      syncNotificationArchivesToCloud(notifications),
    ]);
    if (cloudResult.uploaded > 0) {
      toast({
        title: 'Облачные архивы обновлены',
        description: `Загружено файлов: ${cloudResult.uploaded}`,
      });
    }
    if (cloudResult.errors.length > 0) {
      toast({
        title: 'Ошибка синхронизации облака',
        description: cloudResult.errors.join('; '),
        variant: 'destructive',
      });
    }
  }, [handleSheetSync, handleBankSync, notifications, toast]);

  // Track previous transaction count for auto-sync on realtime changes
  const prevTransactionCountRef = useRef<number>(transactions.length);
  const isInitialMountRef = useRef<boolean>(true);

  // Auto-sync when transactions change via realtime (e.g., from public payout link)
  useEffect(() => {
    // Skip initial mount
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevTransactionCountRef.current = transactions.length;
      return;
    }

    // Only sync if spreadsheet is configured and transaction count changed
    if (spreadsheetId && transactions.length !== prevTransactionCountRef.current) {
      const timerId = setTimeout(() => {
        void handleSheetSync();
      }, 1000);
      prevTransactionCountRef.current = transactions.length;
      return () => clearTimeout(timerId);
    }
  }, [transactions.length, spreadsheetId, handleSheetSync]);

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
    <div className="min-h-screen bg-background flex flex-col">
      <Header 
        collapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        onAddTransaction={handleAddTransaction}
        onSync={handleSync}
        isSyncing={isSyncing}
        incomeCategories={getIncomeCategories()}
        expenseCategories={getExpenseCategories()}
      />
      
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar 
          activeTab={activeTab} 
          onTabChange={setActiveTab}
          collapsed={sidebarCollapsed}
          mobileOpen={mobileMenuOpen}
          onMobileOpenChange={setMobileMenuOpen}
          spreadsheetId={spreadsheetId}
        />
        
        <div className="flex-1 overflow-auto">
        
        <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">

          {/* Statistics Tab */}
          {activeTab === 'statistics' && (
            <div className="animate-fade-in">
              <Tabs defaultValue="balance" className="w-full">
                <TabsList className="mb-4 flex-wrap h-auto gap-1 p-1">
                  <TabsTrigger value="balance" className="text-xs sm:text-sm">{t('balanceByCurrency')}</TabsTrigger>
                  <TabsTrigger value="table" className="text-xs sm:text-sm">{t('transactionsTable')}</TabsTrigger>
                  <TabsTrigger value="calculator" className="text-xs sm:text-sm">Калькулятор</TabsTrigger>
                </TabsList>
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
                    {([...new Set(transactions.map(tx => tx.currency))] as Currency[])
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
                  {transactions.length === 0 && (
                    <p className="text-muted-foreground text-center py-8">{t('noTransactions')}</p>
                  )}
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
              {/* Extension */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('extension')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">Расширение</h4>
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
                  <h4 className="font-semibold text-base sm:text-lg">Облако</h4>
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
                  <h4 className="font-semibold text-base sm:text-lg">Udostępnij formularz</h4>
                  {openSettings.share ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                </button>
                {openSettings.share && (
                  <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-6">
                    <div>
                      <h5 className="font-semibold text-sm mb-3">Расходный ордер</h5>
                      <SharePayoutLink />
                    </div>
                    <Separator />
                    <div>
                      <h5 className="font-semibold text-sm mb-3">Таблица транзакций</h5>
                      <ShareTransactionsLink />
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram Bot */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('telegram')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">Telegram-бот</h4>
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

              {/* Banking */}
              <div className="bg-card rounded-lg shadow-card overflow-hidden">
                <button onClick={() => toggleSetting('banking')} className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-muted/50 transition-colors">
                  <h4 className="font-semibold text-base sm:text-lg">Банки Польши</h4>
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

        </main>
        </div>
      </div>
    </div>
  );
};

export default Index;
