import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { StatCard } from '@/components/StatCard';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionList } from '@/components/TransactionList';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CurrencySelector } from '@/components/CurrencySelector';
import { CategoryManager } from '@/components/CategoryManager';
import { UndoRedoControls } from '@/components/UndoRedoControls';
import { CurrencySettingsDialog, loadVisibleCurrencies, saveVisibleCurrencies } from '@/components/CurrencySettingsDialog';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { BalanceLineChart } from '@/components/charts/BalanceLineChart';
import { IncomeExpenseBarChart } from '@/components/charts/IncomeExpenseBarChart';
import { useTransactionsWithHistory } from '@/hooks/useTransactionsWithHistory';
import { useCategories } from '@/hooks/useCategories';
import { useTranslation } from '@/contexts/LanguageContext';
import { Currency, CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';
import { Wallet, TrendingUp, TrendingDown, Receipt, Settings, BarChart3 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const currencies: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];

const Index = () => {
  const { t, getDateLocale } = useTranslation();
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('PLN');
  const [visibleCurrencies, setVisibleCurrencies] = useState<Currency[]>(loadVisibleCurrencies);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const { toast } = useToast();
  
  const {
    transactions,
    addTransaction,
    deleteTransaction,
    getBalanceByCurrency,
    getRecentTransactions,
    getTransactionsByCategory,
    getMonthlyData,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useTransactionsWithHistory();

  const {
    categories,
    addCategory,
    deleteCategory,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
  } = useCategories();

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (canUndo) {
          undo();
          toast({ title: t('actionUndone') });
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        if (canRedo) {
          redo();
          toast({ title: t('actionRedone') });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canUndo, canRedo, undo, redo, toast, t]);

  const handleVisibleCurrenciesChange = useCallback((newCurrencies: Currency[]) => {
    setVisibleCurrencies(newCurrencies);
    saveVisibleCurrencies(newCurrencies);
  }, []);

  const balance = getBalanceByCurrency(selectedCurrency);
  const recentTransactions = getRecentTransactions(10);
  const incomeByCategory = getTransactionsByCategory('income');
  const expenseByCategory = getTransactionsByCategory('expense');
  const monthlyData = getMonthlyData(selectedCurrency);

  const handleAddTransaction = (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    addTransaction(transaction);
    setIsTransactionDialogOpen(false);
    toast({
      title: transaction.type === 'income' ? t('incomeAdded') : t('expenseAdded'),
      description: `${transaction.amount.toLocaleString(getDateLocale())} ${CURRENCY_SYMBOLS[transaction.currency]}`,
    });
  };

  const handleDeleteTransaction = (id: string) => {
    deleteTransaction(id);
    toast({ title: t('transactionDeleted'), variant: 'destructive' });
  };

  const handleAddCategory = (name: string, type: 'income' | 'expense') => {
    addCategory(name, type);
    toast({ title: t('categoryAdded'), description: name });
  };

  const handleDeleteCategory = (id: string) => {
    const categoryName = getCategoryName(id);
    deleteCategory(id);
    toast({ title: t('categoryDeleted'), description: categoryName, variant: 'destructive' });
  };

  const handleUndo = () => {
    undo();
    toast({ title: t('actionUndone') });
  };

  const handleRedo = () => {
    redo();
    toast({ title: t('actionRedone') });
  };

  const currenciesWithBalance = visibleCurrencies.filter(currency => {
    const { income, expense } = getBalanceByCurrency(currency);
    return income > 0 || expense > 0;
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {/* Currency Selector and Controls */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground">{t('financialOverview')}</h2>
            <p className="text-muted-foreground">{t('mainCurrency')}</p>
          </div>
          <div className="flex items-center gap-2">
            <UndoRedoControls canUndo={canUndo} canRedo={canRedo} onUndo={handleUndo} onRedo={handleRedo} />
            <CurrencySettingsDialog visibleCurrencies={visibleCurrencies} onVisibleCurrenciesChange={handleVisibleCurrenciesChange} />
            <CurrencySelector value={selectedCurrency} onChange={setSelectedCurrency} className="w-[200px]" />
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard title={t('balance')} value={`${balance.balance.toLocaleString(getDateLocale(), { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`} icon={<Wallet className="w-6 h-6" />} variant={balance.balance >= 0 ? 'primary' : 'warning'} delay={0} />
          <StatCard title={t('income')} value={`+${balance.income.toLocaleString(getDateLocale(), { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`} icon={<TrendingUp className="w-6 h-6" />} variant="success" delay={100} />
          <StatCard title={t('expenses')} value={`-${balance.expense.toLocaleString(getDateLocale(), { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`} icon={<TrendingDown className="w-6 h-6" />} variant="warning" delay={200} />
          <StatCard title={t('totalOperations')} value={transactions.length.toString()} icon={<Receipt className="w-6 h-6" />} variant="default" delay={300} />
        </div>

        {/* Currency Balances */}
        {currenciesWithBalance.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceByCurrency')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currenciesWithBalance.map((currency, index) => {
                const currencyBalance = getBalanceByCurrency(currency);
                return <CurrencyBalanceCard key={currency} currency={currency} income={currencyBalance.income} expense={currencyBalance.expense} balance={currencyBalance.balance} delay={index * 100} />;
              })}
            </div>
          </div>
        )}

        {/* Statistics Section */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            {t('statistics')}
          </h3>
          <Tabs defaultValue="bar" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="bar">{t('incomeVsExpenses')}</TabsTrigger>
              <TabsTrigger value="line">{t('balanceOverTime')}</TabsTrigger>
              <TabsTrigger value="pie">{t('categoryDistribution')}</TabsTrigger>
            </TabsList>
            <TabsContent value="bar"><IncomeExpenseBarChart data={monthlyData} /></TabsContent>
            <TabsContent value="line"><BalanceLineChart data={monthlyData} /></TabsContent>
            <TabsContent value="pie">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CategoryPieChart data={incomeByCategory} getCategoryName={getCategoryName} type="income" />
                <CategoryPieChart data={expenseByCategory} getCategoryName={getCategoryName} type="expense" />
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Transactions */}
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="text-lg font-semibold text-foreground">{t('recentOperations')}</h3>
            <div className="flex gap-2">
              <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="font-semibold"><Settings className="w-4 h-4 mr-2" />{t('categories')}</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader><DialogTitle>{t('categoryManagement')}</DialogTitle></DialogHeader>
                  <CategoryManager categories={categories} onAdd={handleAddCategory} onDelete={handleDeleteCategory} />
                </DialogContent>
              </Dialog>
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">{t('addTransaction')}</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader><DialogTitle>{t('newTransaction')}</DialogTitle></DialogHeader>
                  <TransactionForm onSubmit={handleAddTransaction} incomeCategories={getIncomeCategories()} expenseCategories={getExpenseCategories()} />
                </DialogContent>
              </Dialog>
            </div>
          </div>
          <TransactionList transactions={recentTransactions} onDelete={handleDeleteTransaction} getCategoryName={getCategoryName} />
        </div>
      </main>
    </div>
  );
};

export default Index;
