import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { TransactionForm } from '@/components/TransactionForm';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CurrencySelector } from '@/components/CurrencySelector';
import { CategoryManager } from '@/components/CategoryManager';
import { UndoRedoControls } from '@/components/UndoRedoControls';
import { loadVisibleCurrencies, saveVisibleCurrencies, CurrencySettingsContent } from '@/components/CurrencySettingsDialog';
import { CategoryPieChart } from '@/components/charts/CategoryPieChart';
import { BalanceLineChart } from '@/components/charts/BalanceLineChart';
import { IncomeExpenseBarChart } from '@/components/charts/IncomeExpenseBarChart';
import { StatisticsTable } from '@/components/StatisticsTable';
import { useTransactionsWithHistory } from '@/hooks/useTransactionsWithHistory';
import { useCategories } from '@/hooks/useCategories';
import { useDepartments } from '@/hooks/useDepartments';
import { useTranslation } from '@/contexts/LanguageContext';
import { Currency, CURRENCY_SYMBOLS, Transaction, TransactionType } from '@/types/transaction';
import { Settings, BarChart3, FileText } from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';

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
    updateCategory,
    reorderCategories,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
  } = useCategories();

  const { departments } = useDepartments();

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

  const handleAddCategory = (name: string, type: 'income' | 'expense', departmentName?: string) => {
    addCategory(name, type, departmentName);
    toast({ title: t('categoryAdded'), description: name });
  };

  const handleDeleteCategory = (id: string) => {
    const categoryName = getCategoryName(id);
    deleteCategory(id);
    toast({ title: t('categoryDeleted'), description: categoryName, variant: 'destructive' });
  };

  const handleUpdateCategory = (id: string, name: string, departmentName?: string) => {
    updateCategory(id, name, departmentName);
    toast({ title: t('categoryUpdated'), description: name });
  };

  const handleReorderCategories = (type: TransactionType, fromIndex: number, toIndex: number) => {
    reorderCategories(type, fromIndex, toIndex);
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
        {/* Controls Row */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <UndoRedoControls canUndo={canUndo} canRedo={canRedo} onUndo={handleUndo} onRedo={handleRedo} />
            <CurrencySelector value={selectedCurrency} onChange={setSelectedCurrency} className="w-[180px]" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button 
              variant="outline" 
              className="font-semibold"
              onClick={() => window.open('https://3eqp.github.io/pdf-billing-form-builder/', '_blank')}
            >
              <FileText className="w-4 h-4 mr-2" />
              Dowód wypłaty
            </Button>
            <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="font-semibold"><Settings className="w-4 h-4 mr-2" />{t('settings')}</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader><DialogTitle>{t('settings')}</DialogTitle></DialogHeader>
                <div className="overflow-y-auto flex-1 pr-2 space-y-6">
                  <div>
                    <h4 className="font-medium mb-3">{t('currencySettings')}</h4>
                    <CurrencySettingsContent visibleCurrencies={visibleCurrencies} onVisibleCurrenciesChange={handleVisibleCurrenciesChange} />
                  </div>
                  <Separator />
                  <div>
                    <h4 className="font-medium mb-3">{t('categoryManagement')}</h4>
                    <CategoryManager 
                      categories={categories} 
                      onAdd={handleAddCategory} 
                      onDelete={handleDeleteCategory} 
                      onUpdate={handleUpdateCategory}
                      onReorder={handleReorderCategories}
                    />
                  </div>

                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">{t('addTransaction')}</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
                <DialogHeader><DialogTitle>{t('newTransaction')}</DialogTitle></DialogHeader>
                <div className="overflow-y-auto flex-1 pr-2">
                  <TransactionForm onSubmit={handleAddTransaction} incomeCategories={getIncomeCategories()} expenseCategories={getExpenseCategories()} departments={departments} />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Currency Balances */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceByCurrency')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCurrencies.map((currency, index) => {
              const currencyBalance = getBalanceByCurrency(currency);
              return <CurrencyBalanceCard key={currency} currency={currency} income={currencyBalance.income} expense={currencyBalance.expense} balance={currencyBalance.balance} delay={index * 100} />;
            })}
          </div>
        </div>

        {/* Statistics Section */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            {t('statistics')}
          </h3>
          <Tabs defaultValue="table" className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="table">{t('transactionsTable')}</TabsTrigger>
              <TabsTrigger value="bar">{t('incomeVsExpenses')}</TabsTrigger>
              <TabsTrigger value="line">{t('balanceOverTime')}</TabsTrigger>
              <TabsTrigger value="pie">{t('categoryDistribution')}</TabsTrigger>
            </TabsList>
            <TabsContent value="table">
              <StatisticsTable transactions={transactions} getCategoryName={getCategoryName} onDelete={handleDeleteTransaction} />
            </TabsContent>
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

      </main>
    </div>
  );
};

export default Index;
