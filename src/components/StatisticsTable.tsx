import { useState, useMemo } from 'react';
import { Transaction, CURRENCY_SYMBOLS } from '@/types/transaction';
import { useTranslation } from '@/contexts/LanguageContext';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval, startOfYear, endOfYear } from 'date-fns';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface StatisticsTableProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
  getCategoryDepartment?: (id: string) => string | undefined;
  onDelete?: (id: string) => void;
}

type TimeRange = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'last6Months' | 'thisYear';

export const StatisticsTable = ({ transactions, getCategoryName, onDelete }: StatisticsTableProps) => {
  const { t, getDateLocale } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>('all');

  const filteredTransactions = useMemo(() => {
    const now = new Date();
    
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    switch (timeRange) {
      case 'thisMonth':
        startDate = startOfMonth(now);
        endDate = endOfMonth(now);
        break;
      case 'lastMonth':
        startDate = startOfMonth(subMonths(now, 1));
        endDate = endOfMonth(subMonths(now, 1));
        break;
      case 'last3Months':
        startDate = startOfMonth(subMonths(now, 2));
        endDate = endOfMonth(now);
        break;
      case 'last6Months':
        startDate = startOfMonth(subMonths(now, 5));
        endDate = endOfMonth(now);
        break;
      case 'thisYear':
        startDate = startOfYear(now);
        endDate = endOfYear(now);
        break;
      default:
        return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    return transactions
      .filter(t => isWithinInterval(new Date(t.date), { start: startDate!, end: endDate! }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, timeRange]);

  const totals = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    
    filteredTransactions.forEach(t => {
      if (!result[t.currency]) {
        result[t.currency] = { income: 0, expense: 0 };
      }
      if (t.type === 'income') {
        result[t.currency].income += t.amount;
      } else {
        result[t.currency].expense += t.amount;
      }
    });

    return result;
  }, [filteredTransactions]);

  const timeRangeOptions = [
    { value: 'all', label: t('allTime') },
    { value: 'thisMonth', label: t('thisMonth') },
    { value: 'lastMonth', label: t('lastMonth') },
    { value: 'last3Months', label: t('last3Months') },
    { value: 'last6Months', label: t('last6Months') },
    { value: 'thisYear', label: t('thisYear') },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-semibold">{t('transactionsTable')}</CardTitle>
        <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeRangeOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent>
        {/* Totals Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {Object.entries(totals).map(([currency, { income, expense }]) => (
            <div key={currency} className="p-3 bg-secondary/50 rounded-lg space-y-1">
              <p className="text-xs text-muted-foreground font-medium">{currency}</p>
              <div className="flex items-center gap-1 text-success">
                <TrendingUp className="w-3 h-3" />
                <span className="text-sm font-semibold">+{income.toLocaleString(getDateLocale())}</span>
              </div>
              <div className="flex items-center gap-1 text-destructive">
                <TrendingDown className="w-3 h-3" />
                <span className="text-sm font-semibold">-{expense.toLocaleString(getDateLocale())}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Transactions Table */}
        <div className="rounded-md border overflow-auto max-h-[400px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>{t('date')}</TableHead>
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('category')}</TableHead>                <TableHead>{t('departmentName')}</TableHead>                <TableHead className="text-right">{t('amount')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                {onDelete && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={onDelete ? 7 : 6} className="text-center text-muted-foreground py-8">
                    {t('noTransactions')}
                  </TableCell>
                </TableRow>
              ) : (
                filteredTransactions.map(transaction => (
                  <TableRow key={transaction.id}>
                    <TableCell className="whitespace-nowrap">
                      {format(new Date(transaction.date), 'dd.MM.yyyy')}
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium',
                        transaction.type === 'income' 
                          ? 'bg-success/10 text-success' 
                          : 'bg-destructive/10 text-destructive'
                      )}>
                        {transaction.type === 'income' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {transaction.type === 'income' ? t('incomeType') : t('expense')}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{getCategoryName(transaction.category)}</TableCell>
                    <TableCell className="whitespace-nowrap">{transaction.departmentName || (getCategoryDepartment ? getCategoryDepartment(transaction.category) : undefined) || '-'}</TableCell>
                    <TableCell className={cn(
                      'text-right font-semibold whitespace-nowrap',
                      transaction.type === 'income' ? 'text-success' : 'text-destructive'
                    )}>
                      {transaction.type === 'income' ? '+' : '-'}
                      {transaction.amount.toLocaleString(getDateLocale())} {CURRENCY_SYMBOLS[transaction.currency]}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {transaction.description || '-'}
                    </TableCell>
                    {onDelete && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => onDelete(transaction.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        
        <p className="text-xs text-muted-foreground mt-2">
          {t('showingTransactions')}: {filteredTransactions.length}
        </p>
      </CardContent>
    </Card>
  );
};