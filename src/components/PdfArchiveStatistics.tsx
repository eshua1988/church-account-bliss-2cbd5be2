import { useMemo } from 'react';
import { Archive, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Currency, Transaction, TransactionCategory } from '@/types/transaction';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { StatisticsTable } from '@/components/StatisticsTable';
import { useTranslation } from '@/contexts/LanguageContext';
import { usePdfArchiveEntries } from '@/hooks/usePdfArchiveEntries';

interface PdfArchiveStatisticsProps {
  categories: { id: string; name: string; type: string }[];
  getCategoryName: (id: string) => string;
}

const currencies: Currency[] = ['PLN', 'USD', 'EUR', 'UAH', 'RUB', 'BYN'];

const asCurrency = (value: unknown): Currency =>
  currencies.includes(value as Currency) ? value as Currency : 'PLN';

export const PdfArchiveStatistics = ({ categories, getCategoryName }: PdfArchiveStatisticsProps) => {
  const { t } = useTranslation();
  const { entries } = usePdfArchiveEntries();
  const archiveTransactions = useMemo<Transaction[]>(() => entries.map(entry => {
    const date = new Date(entry.document_date);
    const basis = entry.basis || entry.department_name || 'Архивный PDF';
    return {
      id: `pdf-${entry.id}`,
      type: entry.type,
      amount: entry.amount,
      currency: asCurrency(entry.currency),
      category: (entry.category_id || 'other') as TransactionCategory,
      description: basis,
      date: Number.isNaN(date.getTime()) ? new Date(entry.created_at) : date,
      createdAt: new Date(entry.created_at),
      issuedTo: entry.issued_to || undefined,
      departmentName: entry.department_name || basis,
      comment: 'PDF-архив',
    };
  }), [entries]);

  const availableCurrencies = useMemo(() => [...new Set(archiveTransactions.map(transaction => transaction.currency))] as Currency[], [archiveTransactions]);

  const getBalance = (currency: Currency) => {
    const rows = archiveTransactions.filter(transaction => transaction.currency === currency);
    const income = rows.filter(transaction => transaction.type === 'income').reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = rows.filter(transaction => transaction.type === 'expense').reduce((sum, transaction) => sum + transaction.amount, 0);
    return { income, expense, balance: income - expense };
  };

  return <section className="space-y-4">
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Archive className="h-5 w-5" /></div>
      <div className="flex flex-wrap items-baseline gap-x-2"><h2 className="font-semibold">PDF</h2><p className="text-sm text-muted-foreground">— Категории сохранены из документа PDF.</p></div>
    </div>
    <Tabs defaultValue="balance" className="w-full">
      <TabsList className="flex-wrap h-auto gap-1 p-1">
        <TabsTrigger value="balance" className="text-xs sm:text-sm">{t('balanceByCurrency')}</TabsTrigger>
        <TabsTrigger value="table" className="text-xs sm:text-sm">{t('transactionsTable')}</TabsTrigger>
        <TabsTrigger value="calculator" className="text-xs sm:text-sm">Калькулятор</TabsTrigger>
      </TabsList>
      <TabsContent value="balance">
        {availableCurrencies.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground"><FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />В PDF-архиве пока нет документов с суммой.</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{availableCurrencies.map((currency, index) => {
          const balance = getBalance(currency);
          return <CurrencyBalanceCard key={currency} currency={currency} income={balance.income} expense={balance.expense} balance={balance.balance} delay={index * 100} transactions={archiveTransactions} getCategoryName={getCategoryName} />;
        })}</div>}
      </TabsContent>
      <TabsContent value="table"><StatisticsTable transactions={archiveTransactions} getCategoryName={getCategoryName} categories={categories} /></TabsContent>
      <TabsContent value="calculator"><StatisticsTable transactions={archiveTransactions} getCategoryName={getCategoryName} categories={categories} calculatorMode /></TabsContent>
    </Tabs>
  </section>;
};
