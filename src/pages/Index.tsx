import { useState } from 'react';
import { Header } from '@/components/Header';
import { StatCard } from '@/components/StatCard';
import { TransactionForm } from '@/components/TransactionForm';
import { TransactionList } from '@/components/TransactionList';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { CurrencySelector } from '@/components/CurrencySelector';
import { CategoryManager } from '@/components/CategoryManager';
import { useTransactions } from '@/hooks/useTransactions';
import { useCategories } from '@/hooks/useCategories';
import { Currency, CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';
import { Wallet, TrendingUp, TrendingDown, Receipt, Settings } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const currencies: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];

const Index = () => {
  const [selectedCurrency, setSelectedCurrency] = useState<Currency>('RUB');
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false);
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false);
  const { toast } = useToast();
  
  const {
    transactions,
    addTransaction,
    deleteTransaction,
    getBalanceByCurrency,
    getRecentTransactions,
  } = useTransactions();

  const {
    categories,
    addCategory,
    deleteCategory,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
  } = useCategories();

  const balance = getBalanceByCurrency(selectedCurrency);
  const recentTransactions = getRecentTransactions(10);

  const handleAddTransaction = (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    addTransaction(transaction);
    setIsTransactionDialogOpen(false);
    toast({
      title: transaction.type === 'income' ? 'Доход добавлен' : 'Расход добавлен',
      description: `${transaction.amount.toLocaleString('ru-RU')} ${CURRENCY_SYMBOLS[transaction.currency]}`,
    });
  };

  const handleDeleteTransaction = (id: string) => {
    deleteTransaction(id);
    toast({
      title: 'Транзакция удалена',
      variant: 'destructive',
    });
  };

  const handleAddCategory = (name: string, type: 'income' | 'expense') => {
    addCategory(name, type);
    toast({
      title: 'Категория добавлена',
      description: name,
    });
  };

  const handleDeleteCategory = (id: string) => {
    const categoryName = getCategoryName(id);
    deleteCategory(id);
    toast({
      title: 'Категория удалена',
      description: categoryName,
      variant: 'destructive',
    });
  };

  // Calculate totals for all currencies that have transactions
  const currenciesWithBalance = currencies.filter(currency => {
    const { income, expense } = getBalanceByCurrency(currency);
    return income > 0 || expense > 0;
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-8">
        {/* Currency Selector */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground">Обзор финансов</h2>
            <p className="text-muted-foreground">Основная валюта для отображения</p>
          </div>
          <CurrencySelector 
            value={selectedCurrency} 
            onChange={setSelectedCurrency}
            className="w-full sm:w-[240px]"
          />
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            title="Баланс"
            value={`${balance.balance.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`}
            icon={<Wallet className="w-6 h-6" />}
            variant={balance.balance >= 0 ? 'primary' : 'warning'}
            delay={0}
          />
          <StatCard
            title="Доходы"
            value={`+${balance.income.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`}
            icon={<TrendingUp className="w-6 h-6" />}
            variant="success"
            delay={100}
          />
          <StatCard
            title="Расходы"
            value={`-${balance.expense.toLocaleString('ru-RU', { minimumFractionDigits: 2 })} ${CURRENCY_SYMBOLS[selectedCurrency]}`}
            icon={<TrendingDown className="w-6 h-6" />}
            variant="warning"
            delay={200}
          />
          <StatCard
            title="Всего операций"
            value={transactions.length.toString()}
            icon={<Receipt className="w-6 h-6" />}
            variant="default"
            delay={300}
          />
        </div>

        {/* Currency Balances */}
        {currenciesWithBalance.length > 0 && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-4">Баланс по валютам</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {currenciesWithBalance.map((currency, index) => {
                const currencyBalance = getBalanceByCurrency(currency);
                return (
                  <CurrencyBalanceCard
                    key={currency}
                    currency={currency}
                    income={currencyBalance.income}
                    expense={currencyBalance.expense}
                    balance={currencyBalance.balance}
                    delay={index * 100}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Add Transaction Button and Recent Transactions */}
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="text-lg font-semibold text-foreground">Последние операции</h3>
            <div className="flex gap-2">
              {/* Category Settings Dialog */}
              <Dialog open={isCategoryDialogOpen} onOpenChange={setIsCategoryDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="font-semibold">
                    <Settings className="w-4 h-4 mr-2" />
                    Категории
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Управление категориями</DialogTitle>
                  </DialogHeader>
                  <CategoryManager
                    categories={categories}
                    onAdd={handleAddCategory}
                    onDelete={handleDeleteCategory}
                  />
                </DialogContent>
              </Dialog>

              {/* Transaction Dialog */}
              <Dialog open={isTransactionDialogOpen} onOpenChange={setIsTransactionDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200">
                    Добавить транзакцию
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Новая транзакция</DialogTitle>
                  </DialogHeader>
                  <TransactionForm 
                    onSubmit={handleAddTransaction}
                    incomeCategories={getIncomeCategories()}
                    expenseCategories={getExpenseCategories()}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <TransactionList 
            transactions={recentTransactions} 
            onDelete={handleDeleteTransaction}
            getCategoryName={getCategoryName}
          />
        </div>
      </main>
    </div>
  );
};

export default Index;
