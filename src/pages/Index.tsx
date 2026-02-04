import { useState, useCallback } from 'react';
import { Header } from '@/components/Header';
import { TransactionForm } from '@/components/TransactionForm';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CategoryManager } from '@/components/CategoryManager';
import { loadVisibleCurrencies, saveVisibleCurrencies, CurrencySettingsContent } from '@/components/CurrencySettingsDialog';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { BalanceLineChart } from '@/components/charts/BalanceLineChart';
import { IncomeExpenseBarChart } from '@/components/charts/IncomeExpenseBarChart';
import { StatisticsTable } from '@/components/StatisticsTable';
import { PayoutGenerator } from '@/components/PayoutGenerator';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { useTranslation } from '@/contexts/LanguageContext';
import { Currency, CURRENCY_SYMBOLS, Transaction, TransactionType } from '@/types/transaction';
import { Loader2 } from 'lucide-react';
import ImportPayout from '@/components/ImportPayout';
import DateRangeFilter from '@/components/DateRangeFilter';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { AppSidebar } from '@/components/AppSidebar';
import { GoogleSheetsSync } from '@/components/GoogleSheetsSync';
import { SharePayoutLink } from '@/components/SharePayoutLink';

const currencies: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];

const Index = () => {
  const { t, getDateLocale } = useTranslation();
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('PLN');
  const [visibleCurrencies, setVisibleCurrencies] = useState<Currency[]>(loadVisibleCurrencies);
  const [activeTab, setActiveTab] = useState<'balance' | 'statistics' | 'payout' | 'settings'>('balance');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { toast } = useToast();
  
  const {
    transactions,
    loading: transactionsLoading,
    addTransaction,
    deleteTransaction,
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

  const handleVisibleCurrenciesChange = useCallback((newCurrencies: Currency[]) => {
    setVisibleCurrencies(newCurrencies);
    saveVisibleCurrencies(newCurrencies);
  }, []);

  const balance = getBalanceByCurrency(selectedCurrency);
  const incomeByCategory = getTransactionsByCategory('income');
  const expenseByCategory = getTransactionsByCategory('expense');
  const monthlyData = getMonthlyData(selectedCurrency);
  const [period, setPeriod] = useState<{ from?: Date; to?: Date }>({});

  const handleAddTransaction = async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    try {
      await addTransaction(transaction);
      toast({
        title: transaction.type === 'income' ? t('incomeAdded') : t('expenseAdded'),
        description: `${transaction.amount.toLocaleString(getDateLocale())} ${CURRENCY_SYMBOLS[transaction.currency]}`,
      });
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
        />
        
        <div className="flex-1 overflow-auto">
        
        <main className="container mx-auto px-3 sm:px-4 py-4 sm:py-8">
          {/* Controls Row - only show for statistics tab */}
          {activeTab === 'statistics' && (
            <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 sm:gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="hidden sm:flex items-center gap-2">
                  <ImportPayout />
                </div>
              </div>
            </div>
          )}

          {/* Balance Tab */}
          {activeTab === 'balance' && (
            <div className="animate-fade-in">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceByCurrency')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleCurrencies
                  .filter((currency) => {
                    const currencyBalance = getBalanceByCurrency(currency);
                    return currencyBalance.income > 0 || currencyBalance.expense > 0;
                  })
                  .map((currency, index) => {
                    const currencyBalance = getBalanceByCurrency(currency);
                    return <CurrencyBalanceCard key={currency} currency={currency} income={currencyBalance.income} expense={currencyBalance.expense} balance={currencyBalance.balance} delay={index * 100} />;
                  })}
              </div>
              {visibleCurrencies.filter((currency) => {
                const currencyBalance = getBalanceByCurrency(currency);
                return currencyBalance.income > 0 || currencyBalance.expense > 0;
              }).length === 0 && (
                <p className="text-muted-foreground text-center py-8">{t('noTransactions')}</p>
              )}
            </div>
          )}

          {/* Statistics Tab */}
          {activeTab === 'statistics' && (
            <div className="animate-fade-in">
              <Tabs defaultValue="table" className="w-full">
                <TabsList className="mb-4 flex-wrap h-auto gap-1 p-1">
                  <TabsTrigger value="table" className="text-xs sm:text-sm">{t('transactionsTable')}</TabsTrigger>
                  <TabsTrigger value="bar" className="text-xs sm:text-sm">{t('incomeVsExpenses')}</TabsTrigger>
                  <TabsTrigger value="line" className="text-xs sm:text-sm">{t('balanceOverTime')}</TabsTrigger>
                  <TabsTrigger value="pie" className="text-xs sm:text-sm">{t('categoryDistribution')}</TabsTrigger>
                </TabsList>
                <TabsContent value="table">
                  <div className="overflow-x-auto -mx-3 sm:mx-0">
                    <div className="min-w-[600px] sm:min-w-0 px-3 sm:px-0">
                      <StatisticsTable transactions={transactions} getCategoryName={getCategoryName} onDelete={handleDeleteTransaction} />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="bar"><IncomeExpenseBarChart data={monthlyData} currency={selectedCurrency} /></TabsContent>
                <TabsContent value="line">
                  <div className="mb-4 flex items-center justify-end">
                    <DateRangeFilter value={period} onChange={setPeriod} />
                  </div>
                  <BalanceLineChart data={monthlyData} currency={selectedCurrency} startDate={period.from} endDate={period.to} />
                </TabsContent>
                <TabsContent value="pie">
                  <div className="grid grid-cols-1 gap-4">
                    <CategoryPieChart data={incomeByCategory} getCategoryName={getCategoryName} type="income" />
                    <CategoryPieChart data={expenseByCategory} getCategoryName={getCategoryName} type="expense" />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Payout Generator Tab */}
          {activeTab === 'payout' && (
            <div className="animate-fade-in space-y-6">
              <PayoutGenerator />
              <SharePayoutLink />
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="animate-fade-in space-y-4 sm:space-y-6">
              <div className="bg-card rounded-lg p-4 sm:p-6 shadow-card">
                <h4 className="font-semibold text-base sm:text-lg mb-3 sm:mb-4">{t('currencySettings')}</h4>
                <CurrencySettingsContent visibleCurrencies={visibleCurrencies} onVisibleCurrenciesChange={handleVisibleCurrenciesChange} />
              </div>
              <Separator />
              <div className="bg-card rounded-lg p-4 sm:p-6 shadow-card">
                <h4 className="font-semibold text-base sm:text-lg mb-3 sm:mb-4">{t('categoryManagement')}</h4>
                <CategoryManager 
                  categories={categories} 
                  onAdd={handleAddCategory} 
                  onDelete={handleDeleteCategory} 
                  onUpdate={handleUpdateCategory}
                  onReorder={handleReorderCategories}
                />
              </div>
              <Separator />
              <div className="bg-card rounded-lg p-4 sm:p-6 shadow-card">
                <GoogleSheetsSync 
                  transactions={transactions} 
                  getCategoryName={getCategoryName} 
                  onDeleteTransaction={deleteTransaction}
                />
              </div>
            </div>
          )}
        </main>
        </div>
      </div>
    </div>
  );
};

export default Index;
