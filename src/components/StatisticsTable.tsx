import React, { useState, useMemo, useCallback } from 'react';
import { Transaction, CURRENCY_SYMBOLS } from '@/types/transaction';
import { useTranslation } from '@/contexts/LanguageContext';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval, startOfYear, endOfYear } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Trash2, Download, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import DateRangeFilter from '@/components/DateRangeFilter';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Notification } from '@/hooks/useNotifications';

interface StatisticsTableProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
  onDelete?: (id: string) => void;
  onUpdate?: (id: string, updates: Partial<Transaction>) => void;
  selectedCurrency?: string | null;
  categories?: { id: string; name: string; type: string }[];
  notifications?: Notification[];
  onLinkNotification?: (transactionId: string, notificationId: string) => void;
}

type TimeRange = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'last6Months' | 'thisYear';

export const StatisticsTable = ({ transactions, getCategoryName, onDelete, onUpdate, selectedCurrency, categories = [], notifications = [], onLinkNotification }: StatisticsTableProps) => {
  const { t, getDateLocale } = useTranslation();
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedTransactions, setSelectedTransactions] = useState<Set<string>>(new Set());
  const [expandedTransactions, setExpandedTransactions] = useState<Set<string>>(new Set());
  const [internalCurrencyFilter, setInternalCurrencyFilter] = useState<string | null>(null);

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;

    // Apply currency filter (internal or external)
    const activeCurrency = internalCurrencyFilter || selectedCurrency;
    if (activeCurrency) {
      filtered = filtered.filter(t => t.currency === activeCurrency);
    }

    // Apply type filter
    filtered = filtered.filter(t => typeFilter === 'all' || t.type === typeFilter);

    // Apply category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category === categoryFilter);
    }

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

    return filtered.sort((a, b) => {
      const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateDiff !== 0) return dateDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [transactions, timeRange, typeFilter, customDateRange, selectedCurrency, categoryFilter, internalCurrencyFilter]);

  // Calculate totals from all transactions (unfiltered by currency) to always show all currency cards
  const totals = useMemo(() => {
    const result: Record<string, { income: number; expense: number }> = {};
    
    // Use transactions filtered by everything except currency
    let filtered = transactions;
    filtered = filtered.filter(t => typeFilter === 'all' || t.type === typeFilter);
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(t => t.category === categoryFilter);
    }
    
    filtered.forEach(t => {
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
  }, [transactions, typeFilter, categoryFilter]);

  const toggleCurrencyFilter = (currency: string) => {
    setInternalCurrencyFilter(prev => prev === currency ? null : currency);
  };

  const exportToPDF = () => {
    try {
      // Create HTML content for PDF
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            h1 { font-size: 18px; margin-bottom: 5px; }
            .info { font-size: 11px; margin: 5px 0; }
            .summary { font-size: 11px; margin: 10px 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #ccc; padding: 8px; text-align: left; font-size: 10px; }
            th { background-color: #6496C8; color: white; font-weight: bold; }
            tr:nth-child(even) { background-color: #f9f9f9; }
          </style>
        </head>
        <body>
          <h1>${t('transactionsTable')}</h1>
          <div class="info"><strong>${t('timeRange')}:</strong> ${
            customDateRange.from && customDateRange.to
              ? `${format(customDateRange.from, 'dd.MM.yyyy')} — ${format(customDateRange.to, 'dd.MM.yyyy')}`
              : t('allTime')
          }</div>
          <div class="info"><strong>${t('type')}:</strong> ${
            typeFilter === 'income' ? t('income') : typeFilter === 'expense' ? t('expenses') : t('allTime')
          }</div>
          
          <div class="summary">
            <strong>Totals:</strong><br>
            ${Object.entries(totals)
              .map(([currency, { income, expense }]) => 
                `${currency}: +${income.toLocaleString()} / -${expense.toLocaleString()}`
              )
              .join('<br>')}
          </div>
          
          <table>
            <thead>
              <tr>
                <th>${t('date')}</th>
                <th>${t('type')}</th>
                <th>${t('category')}</th>
                <th>${t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              ${filteredTransactions
                .map((tx) => `
                  <tr>
                    <td>${format(new Date(tx.date), 'dd.MM.yyyy')}</td>
                    <td>${tx.type === 'income' ? t('income') : t('expenses')}</td>
                    <td>${getCategoryName(tx.category)}</td>
                    <td>${tx.type === 'income' ? '+' : '-'}${tx.amount.toLocaleString()} ${CURRENCY_SYMBOLS[tx.currency]}</td>
                  </tr>
                `)
                .join('')}
            </tbody>
          </table>
        </body>
        </html>
      `;

      // Create blob and download
      const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `transactions_${format(new Date(), 'yyyy-MM-dd')}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (e) {
      console.error('Export failed:', e);
      alert('Failed to export file');
    }
  };

  const toggleTransaction = (id: string) => {
    setSelectedTransactions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleAllTransactions = () => {
    if (selectedTransactions.size === filteredTransactions.length) {
      setSelectedTransactions(new Set());
    } else {
      setSelectedTransactions(new Set(filteredTransactions.map(t => t.id)));
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedTransactions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const isAllSelected = filteredTransactions.length > 0 && selectedTransactions.size === filteredTransactions.length;

  const handleDeleteSelected = () => {
    if (!onDelete) return;
    selectedTransactions.forEach(id => onDelete(id));
    setSelectedTransactions(new Set());
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-semibold mb-3">{t('transactionsTable')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={typeFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTypeFilter('all')}
            className="font-medium"
          >
            Все
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
          <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
          {categories.length > 0 && (
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder={t('category')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все категории</SelectItem>
                {categories.map(cat => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={exportToPDF} className="font-medium">
            <Download className="w-4 h-4 mr-2" />
            {t('export') || 'HTML'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Totals Summary */}
        <div className="flex gap-3 mb-4 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          {Object.entries(totals).map(([currency, { income, expense }]) => (
            <div 
              key={currency} 
              onClick={() => toggleCurrencyFilter(currency)}
              className={cn(
                "p-3 rounded-lg space-y-1 cursor-pointer transition-all flex-shrink-0 min-w-[110px]",
                internalCurrencyFilter === currency 
                  ? "bg-primary/20 ring-2 ring-primary" 
                  : "bg-secondary/50 hover:bg-secondary/70"
              )}
            >
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

        {/* Transactions — mobile cards / desktop table */}

        {/* Mobile: card list */}
        <div className="sm:hidden space-y-2">
          {filteredTransactions.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">{t('noTransactions')}</p>
          ) : (
            filteredTransactions.map(transaction => {
              const isExpanded = expandedTransactions.has(transaction.id);
              return (
                <React.Fragment key={transaction.id}>
                  <div
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      selectedTransactions.has(transaction.id) ? 'bg-muted/50' : 'bg-card'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Checkbox
                          checked={selectedTransactions.has(transaction.id)}
                          onCheckedChange={() => toggleTransaction(transaction.id)}
                        />
                        <span className={cn(
                          'w-2 h-2 rounded-full flex-shrink-0',
                          transaction.type === 'income' ? 'bg-success' : 'bg-destructive'
                        )} />
                        <span className="text-sm truncate">{getCategoryName(transaction.category) === 'Неизвестно' && transaction.type === 'income' ? 'Пожертвование Онлайн' : getCategoryName(transaction.category)}</span>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={cn(
                          'text-sm font-semibold',
                          transaction.type === 'income' ? 'text-success' : 'text-destructive'
                        )}>
                          {transaction.type === 'income' ? '+' : '-'}{transaction.amount.toLocaleString(getDateLocale())} {CURRENCY_SYMBOLS[transaction.currency]}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={() => toggleExpand(transaction.id)}>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        {onDelete && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onDelete(transaction.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 ml-8">
                      {format(new Date(transaction.date), 'dd.MM.yyyy')}
                    </p>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-muted-foreground text-xs">{t('type')}</p>
                          <p className={cn('font-medium', transaction.type === 'income' ? 'text-success' : 'text-destructive')}>
                            {transaction.type === 'income' ? t('incomeType') : t('expense')}
                          </p>
                        </div>
                        {transaction.description && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">{t('description')}</p>
                            <p className="font-medium">{transaction.description}</p>
                          </div>
                        )}
                        {transaction.bankTitle && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">Tytuł</p>
                            <p className="font-medium">{transaction.bankTitle}</p>
                          </div>
                        )}
                        {transaction.bankSender && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">Nadawca</p>
                            <p className="font-medium">{transaction.bankSender}</p>
                          </div>
                        )}
                        {transaction.bankRecipient && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">Odbiorca</p>
                            <p className="font-medium">{transaction.bankRecipient}</p>
                          </div>
                        )}
                        {transaction.issuedTo && (
                          <div className="col-span-2">
                            <p className="text-muted-foreground text-xs">Wydano</p>
                            <p className="font-medium">{transaction.issuedTo}</p>
                          </div>
                        )}
                        {onUpdate && (
                          <>
                            {onLinkNotification && notifications.length > 0 && (() => {
                              const linked = notifications.find(n => n.metadata?.transaction_id === transaction.id);
                              const available = notifications.filter(n => !n.metadata?.transaction_id && n.metadata?.amount);
                              if (!linked && available.length === 0) return null;
                              return (
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs mb-1">Привязать уведомление</p>
                                  <Select
                                    value={linked?.id || '__none__'}
                                    onValueChange={(val) => {
                                      if (val !== '__none__') {
                                        onLinkNotification(transaction.id, val);
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue placeholder="Выберите уведомление..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">— Заполнить вручную —</SelectItem>
                                      {linked && (
                                        <SelectItem key={linked.id} value={linked.id}>
                                          ✓ {linked.metadata?.issued_to || linked.title} — {linked.metadata?.amount} {linked.metadata?.currency || 'PLN'}
                                        </SelectItem>
                                      )}
                                      {available.map(n => (
                                        <SelectItem key={n.id} value={n.id}>
                                          {n.metadata?.issued_to || n.title} — {n.metadata?.amount} {n.metadata?.currency || 'PLN'} ({n.metadata?.department_name || 'без отдела'})
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })()}
                            {!notifications.find(n => n.metadata?.transaction_id === transaction.id) && (
                              <>
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs mb-1">Название отдела</p>
                                  <Select
                                    value={transaction.category || '__none__'}
                                    onValueChange={(val) => {
                                      if (val === '__none__') {
                                        onUpdate(transaction.id, { category: null as any, departmentName: null as any });
                                      } else {
                                        const cat = categories.find(c => c.id === val);
                                        onUpdate(transaction.id, { category: val as any, departmentName: cat?.name });
                                      }
                                    }}
                                  >
                                    <SelectTrigger className="h-8 text-sm">
                                      <SelectValue placeholder="Выберите отдел..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">— Без отдела —</SelectItem>
                                      {(transaction.type === 'income'
                                        ? categories.filter(c => c.type === 'income')
                                        : categories.filter(c => c.type === 'expense')
                                      ).map(c => (
                                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs mb-1">Комментарий</p>
                                  <Textarea
                                    className="text-sm min-h-[60px]"
                                    placeholder="Добавить комментарий..."
                                    defaultValue={transaction.comment || ''}
                                    onBlur={(e) => {
                                      const val = e.target.value.trim();
                                      if (val !== (transaction.comment || '')) {
                                        onUpdate(transaction.id, { comment: val || null });
                                      }
                                    }}
                                  />
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Desktop: table */}
        <div className="hidden sm:block rounded-md border overflow-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background z-10 [&_tr]:border-b">
              <tr className="border-b">
                <th className="h-12 px-2 text-left align-middle font-medium text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleAllTransactions} aria-label="Select all" />
                    {selectedTransactions.size > 1 && onDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:bg-destructive/10"
                        onClick={handleDeleteSelected}
                        title={`Удалить выбранные (${selectedTransactions.size})`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </th>
                <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground whitespace-nowrap">{t('date')}</th>
                <th className="h-12 px-3 text-left align-middle font-medium text-muted-foreground">{t('category')}</th>
                <th className="h-12 px-2 text-right align-middle font-medium text-muted-foreground whitespace-nowrap">{t('amount')}</th>
                <th className="h-12 w-8 px-1"></th>
                {onDelete && <th className="h-12 w-8 px-1"></th>}
              </tr>
            </thead>
            <tbody className="[&_tr:last-child]:border-0">
              {filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={onDelete ? 6 : 5} className="text-center text-muted-foreground py-8 p-4">
                    {t('noTransactions')}
                  </td>
                </tr>
              ) : (
                filteredTransactions.map(transaction => {
                  const isExpanded = expandedTransactions.has(transaction.id);
                  return (
                    <React.Fragment key={transaction.id}>
                      <tr className={cn("border-b transition-colors hover:bg-muted/50", selectedTransactions.has(transaction.id) && "bg-muted/50")}>
                        <td className="p-4 w-10 px-2 align-middle">
                          <Checkbox checked={selectedTransactions.has(transaction.id)} onCheckedChange={() => toggleTransaction(transaction.id)} aria-label={`Select transaction ${transaction.id}`} />
                        </td>
                        <td className="p-4 px-3 whitespace-nowrap align-middle">
                          {format(new Date(transaction.date), 'dd.MM.yyyy')}
                        </td>
                        <td className="p-4 px-3 align-middle">
                          <div className="flex items-center gap-2">
                            <span className={cn('w-2 h-2 rounded-full flex-shrink-0', transaction.type === 'income' ? 'bg-success' : 'bg-destructive')} />
                            <span className="truncate">{getCategoryName(transaction.category) === 'Неизвестно' && transaction.type === 'income' ? 'Пожертвование Онлайн' : getCategoryName(transaction.category)}</span>
                          </div>
                        </td>
                        <td className={cn('p-4 px-2 text-right font-semibold whitespace-nowrap align-middle', transaction.type === 'income' ? 'text-success' : 'text-destructive')}>
                          {transaction.type === 'income' ? '+' : '-'}{transaction.amount.toLocaleString(getDateLocale())} {CURRENCY_SYMBOLS[transaction.currency]}
                        </td>
                        <td className="p-4 w-8 px-1 align-middle">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleExpand(transaction.id)}>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </td>
                        {onDelete && (
                          <td className="p-4 w-8 px-1 align-middle">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onDelete(transaction.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-muted/30 border-b">
                          <td colSpan={onDelete ? 6 : 5} className="p-4 py-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-muted-foreground text-xs">{t('type')}</p>
                                <p className={cn(
                                  'font-medium',
                                  transaction.type === 'income' ? 'text-success' : 'text-destructive'
                                )}>
                                  {transaction.type === 'income' ? t('incomeType') : t('expense')}
                                </p>
                              </div>
                              {transaction.description && (
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs">{t('description')}</p>
                                  <p className="font-medium">{transaction.description}</p>
                                </div>
                              )}
                              {transaction.bankTitle && (
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs">Tytuł</p>
                                  <p className="font-medium">{transaction.bankTitle}</p>
                                </div>
                              )}
                              {transaction.bankSender && (
                                <div>
                                  <p className="text-muted-foreground text-xs">Nadawca</p>
                                  <p className="font-medium">{transaction.bankSender}</p>
                                </div>
                              )}
                              {transaction.bankRecipient && (
                                <div>
                                  <p className="text-muted-foreground text-xs">Odbiorca</p>
                                  <p className="font-medium">{transaction.bankRecipient}</p>
                                </div>
                              )}
                              {transaction.issuedTo && (
                                <div>
                                  <p className="text-muted-foreground text-xs">{t('issuedTo') || 'Выдано'}</p>
                                  <p className="font-medium">{transaction.issuedTo}</p>
                                </div>
                              )}
                              {transaction.decisionNumber && (
                                <div>
                                  <p className="text-muted-foreground text-xs">{t('decisionNumber') || 'Номер решения'}</p>
                                  <p className="font-medium">{transaction.decisionNumber}</p>
                                </div>
                              )}
                              {transaction.amountInWords && (
                                <div className="col-span-2">
                                  <p className="text-muted-foreground text-xs">{t('amountInWords') || 'Сумма прописью'}</p>
                                  <p className="font-medium">{transaction.amountInWords}</p>
                                </div>
                              )}
                              {transaction.cashierName && (
                                <div>
                                  <p className="text-muted-foreground text-xs">{t('cashierName') || 'Кассир'}</p>
                                  <p className="font-medium">{transaction.cashierName}</p>
                                </div>
                              )}
                              {onUpdate && (
                                <>
                                  {onLinkNotification && notifications.length > 0 && (() => {
                                    const linked = notifications.find(n => n.metadata?.transaction_id === transaction.id);
                                    const available = notifications.filter(n => !n.metadata?.transaction_id && n.metadata?.amount);
                                    if (!linked && available.length === 0) return null;
                                    return (
                                      <div className="col-span-2">
                                        <p className="text-muted-foreground text-xs mb-1">Привязать уведомление</p>
                                        <Select
                                          value={linked?.id || '__none__'}
                                          onValueChange={(val) => {
                                            if (val !== '__none__') {
                                              onLinkNotification(transaction.id, val);
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-8 text-sm">
                                            <SelectValue placeholder="Выберите уведомление..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">— Заполнить вручную —</SelectItem>
                                            {linked && (
                                              <SelectItem key={linked.id} value={linked.id}>
                                                ✓ {linked.metadata?.issued_to || linked.title} — {linked.metadata?.amount} {linked.metadata?.currency || 'PLN'}
                                              </SelectItem>
                                            )}
                                            {available.map(n => (
                                              <SelectItem key={n.id} value={n.id}>
                                                {n.metadata?.issued_to || n.title} — {n.metadata?.amount} {n.metadata?.currency || 'PLN'} ({n.metadata?.department_name || 'без отдела'})
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    );
                                  })()}
                                  {!notifications.find(n => n.metadata?.transaction_id === transaction.id) && (
                                    <>
                                      <div className="col-span-2">
                                        <p className="text-muted-foreground text-xs mb-1">Название отдела</p>
                                        <Select
                                          value={transaction.category || '__none__'}
                                          onValueChange={(val) => {
                                            if (val === '__none__') {
                                              onUpdate(transaction.id, { category: null as any, departmentName: null as any });
                                            } else {
                                              const cat = categories.find(c => c.id === val);
                                              onUpdate(transaction.id, { category: val as any, departmentName: cat?.name });
                                            }
                                          }}
                                        >
                                          <SelectTrigger className="h-8 text-sm">
                                            <SelectValue placeholder="Выберите отдел..." />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">— Без отдела —</SelectItem>
                                            {(transaction.type === 'income'
                                              ? categories.filter(c => c.type === 'income')
                                              : categories.filter(c => c.type === 'expense')
                                            ).map(c => (
                                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                      <div className="col-span-2">
                                        <p className="text-muted-foreground text-xs mb-1">Комментарий</p>
                                        <Textarea
                                          className="text-sm min-h-[60px]"
                                          placeholder="Добавить комментарий..."
                                          defaultValue={transaction.comment || ''}
                                          onBlur={(e) => {
                                            const val = e.target.value.trim();
                                            if (val !== (transaction.comment || '')) {
                                              onUpdate(transaction.id, { comment: val || null });
                                            }
                                          }}
                                        />
                                      </div>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {selectedTransactions.size > 0 && (
          <>
            {/* Mobile: fixed bottom bar */}
            <div className="sm:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-2 px-4 py-3 bg-card border-t border-border shadow-lg">
              <p className="text-sm text-primary font-medium">Выбрано: {selectedTransactions.size}</p>
              {selectedTransactions.size > 1 && onDelete && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 px-3 text-sm"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Удалить выбранные
                </Button>
              )}
            </div>
            {/* Desktop: inline bar */}
            <div className="hidden sm:flex items-center gap-2 mt-2">
              <p className="text-xs text-primary">Выбрано: {selectedTransactions.size}</p>
              {selectedTransactions.size > 1 && onDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive hover:bg-destructive/10"
                  onClick={handleDeleteSelected}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Удалить выбранные
                </Button>
              )}
            </div>
          </>
        )}
        <p className="text-xs text-muted-foreground mt-1">
          {t('showingTransactions')}: {filteredTransactions.length}
        </p>
      </CardContent>
    </Card>
  );
};