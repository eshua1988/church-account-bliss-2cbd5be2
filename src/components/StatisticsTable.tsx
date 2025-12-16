import { useState, useMemo } from 'react';
import { Transaction, CURRENCY_SYMBOLS } from '@/types/transaction';
import { useTranslation } from '@/contexts/LanguageContext';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval, startOfYear, endOfYear } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
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
import { TrendingUp, TrendingDown, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import DateRangeFilter from '@/components/DateRangeFilter';

interface StatisticsTableProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
  onDelete?: (id: string) => void;
}

type TimeRange = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'last6Months' | 'thisYear';

export const StatisticsTable = ({ transactions, getCategoryName, onDelete }: StatisticsTableProps) => {
  const { t, getDateLocale } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date }>({});

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Apply type filter
    filtered = filtered.filter(t => typeFilter === 'all' || t.type === typeFilter);

    // Apply date filter (custom range takes precedence over timeRange)
    if (customDateRange.from || customDateRange.to) {
      filtered = filtered.filter(t => {
        const txDate = new Date(t.date);
        if (customDateRange.from && txDate < customDateRange.from) return false;
        if (customDateRange.to) {
          const endDate = new Date(customDateRange.to);
          endDate.setHours(23, 59, 59, 999);
          if (txDate > endDate) return false;
        }
        return true;
      });
    } else {
      // Apply preset timeRange
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
      }

      if (startDate && endDate) {
        filtered = filtered.filter(t => isWithinInterval(new Date(t.date), { start: startDate!, end: endDate! }));
      }
    }

    return filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, timeRange, typeFilter, customDateRange]);

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

  const exportToPDF = () => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;
      let yPosition = 15;

      // Set font that supports Unicode
      doc.setFont('helvetica');

      // Header
      doc.setFontSize(16);
      doc.text(t('transactionsTable'), margin, yPosition);
      yPosition += 10;
      
      // Date range info
      doc.setFontSize(10);
      const dateInfo = customDateRange.from && customDateRange.to
        ? `${format(customDateRange.from, 'dd.MM.yyyy')} — ${format(customDateRange.to, 'dd.MM.yyyy')}`
        : t('allTime');
      doc.text(`${t('timeRange')}: ${dateInfo}`, margin, yPosition);
      yPosition += 8;
      
      // Type filter info
      const typeLabel = typeFilter === 'income' ? t('income') : typeFilter === 'expense' ? t('expenses') : t('allTime');
      doc.text(`${t('type')}: ${typeLabel}`, margin, yPosition);
      yPosition += 10;
      
      // Totals summary
      doc.setFontSize(11);
      doc.text('Totals:', margin, yPosition);
      yPosition += 7;
      
      Object.entries(totals).forEach(([currency, { income, expense }]) => {
        doc.setFontSize(10);
        doc.text(`${currency}: +${income.toLocaleString()} / -${expense.toLocaleString()}`, margin + 5, yPosition);
        yPosition += 6;
      });

      yPosition += 8;

      // Prepare table data
      const columns = [t('date'), t('type'), t('category'), t('amount')];
      const rows: (string | number)[][] = filteredTransactions.map((tx) => [
        format(new Date(tx.date), 'dd.MM.yyyy'),
        tx.type === 'income' ? t('income') : t('expenses'),
        getCategoryName(tx.category),
        `${tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString()} ${CURRENCY_SYMBOLS[tx.currency]}`,
      ]);

      // Use autoTable for better text handling
      (doc as any).autoTable({
        startY: yPosition,
        head: [columns],
        body: rows,
        margin: margin,
        styles: {
          font: 'helvetica',
          fontSize: 9,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [100, 150, 200],
          textColor: [255, 255, 255],
          font: 'helvetica',
          fontStyle: 'bold',
        },
      });

      doc.save(`transactions_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    }
  };

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
      <CardHeader className="flex flex-col space-y-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">{t('transactionsTable')}</CardTitle>
          <div className="flex items-center gap-2">
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
            <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
            <Button variant="outline" size="sm" onClick={exportToPDF} className="font-medium">
              <Download className="w-4 h-4 mr-2" />
              {t('export') || 'PDF'}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={typeFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTypeFilter('all')}
            className="font-medium"
          >
            {t('allTime')}
          </Button>
          <Button
            variant={typeFilter === 'income' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTypeFilter('income')}
            className="font-medium"
          >
            {t('income')}
          </Button>
          <Button
            variant={typeFilter === 'expense' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTypeFilter('expense')}
            className="font-medium"
          >
            {t('expenses')}
          </Button>
        </div>
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
                <TableHead>{t('category')}</TableHead>
                <TableHead className="text-right">{t('amount')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                {onDelete && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTransactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={onDelete ? 6 : 5} className="text-center text-muted-foreground py-8">
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