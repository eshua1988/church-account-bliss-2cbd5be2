import React, { useState, useEffect, useCallback } from 'react';
import { useSidebar } from '@/components/ui/sidebar';
import { Header } from '@/components/Header';
import { TransactionForm } from '@/components/TransactionForm';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CurrencySelector } from '@/components/CurrencySelector';
import { CategoryManager } from '@/components/CategoryManager';
import { DepartmentManager } from '@/components/DepartmentManager';
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
import ImportPayout from '@/components/ImportPayout';
import DateRangeFilter from '@/components/DateRangeFilter';
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
import { AppSidebar } from '@/components/AppSidebar';
import { GoogleSheetsSync } from '@/components/GoogleSheetsSync';

const currencies: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];

const Index = () => {
  const { t, getDateLocale } = useTranslation();
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('PLN');
  const [visibleCurrencies, setVisibleCurrencies] = useState<Currency[]>(loadVisibleCurrencies);
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'balance' | 'statistics' | 'settings'>('balance');
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
    canUndo,
    canRedo,
    undo,
    redo,
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

  const {
    departments,
    addDepartment,
    deleteDepartment,
    updateDepartment,
  } = useDepartments();
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
  const [period, setPeriod] = useState<{ from?: Date; to?: Date }>({});

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

  const handleUpdateCategory = (id: string, name: string) => {
    updateCategory(id, name);
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

  const { open, isMobile } = useSidebar();

  return (
    <div className="min-h-screen bg-background">
      <Header canUndo={canUndo} canRedo={canRedo} onUndo={handleUndo} onRedo={handleRedo} />
      <main
        className={`container mx-auto px-4 py-8 transition-all duration-200 ${open && !isMobile ? 'ml-[16rem]' : ''}`}
      >
          {/* Controls Row */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CurrencySelector value={selectedCurrency} onChange={setSelectedCurrency} className="w-[180px]" availableCurrencies={visibleCurrencies} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  className="font-semibold"
                  onClick={() => window.open('https://3eqp.github.io/pdf-billing-form-builder/', '_blank')}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Dowód wypłaty
                </Button>
                <ImportPayout />
              </div>
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">{t('addTransaction')}</Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-hidden flex flex-col">
                  <DialogHeader><DialogTitle>{t('newTransaction')}</DialogTitle></DialogHeader>
                  <div className="overflow-y-auto flex-1 pr-2">
                    <TransactionForm onSubmit={handleAddTransaction} incomeCategories={getIncomeCategories()} expenseCategories={getExpenseCategories()} />
                  </div>
                </DialogContent>
              </Dialog>
            </div>

          {/* Balance Tab */}
          {activeTab === 'balance' && (
            <div className="animate-fade-in">
              <h3 className="text-lg font-semibold text-foreground mb-4">{t('balanceByCurrency')}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleCurrencies.map((currency, index) => {
                  const currencyBalance = getBalanceByCurrency(currency);
                  return <CurrencyBalanceCard key={currency} currency={currency} income={currencyBalance.income} expense={currencyBalance.expense} balance={currencyBalance.balance} delay={index * 100} />;
                })}
              </div>
            </div>
          )}

          {/* Statistics Tab */}
          {activeTab === 'statistics' && (
            <div className="animate-fade-in">
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
                <TabsContent value="bar"><IncomeExpenseBarChart data={monthlyData} currency={selectedCurrency} /></TabsContent>
                <TabsContent value="line">
                  <div className="mb-4 flex items-center justify-end">
                    <DateRangeFilter value={period} onChange={setPeriod} />
                  </div>
                  <BalanceLineChart data={monthlyData} currency={selectedCurrency} startDate={period.from} endDate={period.to} />
                </TabsContent>
                <TabsContent value="pie">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CategoryPieChart data={incomeByCategory} getCategoryName={getCategoryName} type="income" />
                    <CategoryPieChart data={expenseByCategory} getCategoryName={getCategoryName} type="expense" />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="animate-fade-in space-y-6">
              <div className="bg-card rounded-lg p-6 shadow-card">
                <h4 className="font-semibold text-lg mb-4">{t('currencySettings')}</h4>
                <CurrencySettingsContent visibleCurrencies={visibleCurrencies} onVisibleCurrenciesChange={handleVisibleCurrenciesChange} />
              </div>
              <Separator />
              <div className="bg-card rounded-lg p-6 shadow-card">
                <h4 className="font-semibold text-lg mb-4">{t('categoryManagement')}</h4>
                <CategoryManager 
                  categories={categories} 
                  onAdd={handleAddCategory} 
                  onDelete={handleDeleteCategory} 
                  onUpdate={handleUpdateCategory}
                  onReorder={handleReorderCategories}
                />
              </div>
              <Separator />
              <div className="bg-card rounded-lg p-6 shadow-card">
                <GoogleSheetsSync transactions={transactions} getCategoryName={getCategoryName} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Index;
