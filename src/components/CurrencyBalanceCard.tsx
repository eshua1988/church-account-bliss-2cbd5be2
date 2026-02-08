import { useState, useMemo } from 'react';
import { Currency, CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';
import { TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { format, startOfWeek, endOfWeek, subWeeks, isWithinInterval } from 'date-fns';
import { pl, ru, enUS, uk } from 'date-fns/locale';

interface CurrencyBalanceCardProps {
  currency: Currency;
  income: number;
  expense: number;
  balance: number;
  delay?: number;
  transactions?: Transaction[];
  getCategoryName?: (id: string) => string;
}

const getCurrencyTranslationKey = (currency: Currency) => {
  const keys: Record<Currency, 'currencyRUB' | 'currencyUSD' | 'currencyEUR' | 'currencyUAH' | 'currencyBYN' | 'currencyPLN'> = {
    RUB: 'currencyRUB',
    USD: 'currencyUSD',
    EUR: 'currencyEUR',
    UAH: 'currencyUAH',
    BYN: 'currencyBYN',
    PLN: 'currencyPLN',
  };
  return keys[currency];
};

interface WeekGroup {
  weekLabel: string;
  weekStart: Date;
  weekEnd: Date;
  transactions: Transaction[];
  income: number;
  expense: number;
}

export const CurrencyBalanceCard = ({ 
  currency, 
  income, 
  expense, 
  balance,
  delay = 0,
  transactions = [],
  getCategoryName,
}: CurrencyBalanceCardProps) => {
  const { t, language, getDateLocale } = useTranslation();
  const [showHistory, setShowHistory] = useState(false);
  const [visibleWeeks, setVisibleWeeks] = useState(1); // Start with 1 week
  
  const getLocale = () => {
    switch (language) {
      case 'pl': return pl;
      case 'ru': return ru;
      case 'uk': return uk;
      default: return enUS;
    }
  };

  const formatAmount = (amount: number) => {
    return amount.toLocaleString(getDateLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // Filter transactions for this currency
  const currencyTransactions = useMemo(() => {
    return transactions.filter(t => t.currency === currency);
  }, [transactions, currency]);

  // Group transactions by weeks
  const weekGroups = useMemo(() => {
    const groups: WeekGroup[] = [];
    const now = new Date();
    const maxWeeks = 12; // Maximum weeks to show

    for (let i = 0; i < maxWeeks; i++) {
      const weekStart = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      const weekEnd = endOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      
      const weekTransactions = currencyTransactions.filter(t => 
        isWithinInterval(new Date(t.date), { start: weekStart, end: weekEnd })
      );

      if (weekTransactions.length > 0 || i === 0) {
        let weekLabel: string;
        if (i === 0) {
          weekLabel = t('thisWeek');
        } else if (i === 1) {
          weekLabel = t('previousWeek');
        } else {
          weekLabel = `${i} ${t('weeksAgo')}`;
        }

        const weekIncome = weekTransactions
          .filter(t => t.type === 'income')
          .reduce((sum, t) => sum + t.amount, 0);
        
        const weekExpense = weekTransactions
          .filter(t => t.type === 'expense')
          .reduce((sum, t) => sum + t.amount, 0);

        groups.push({
          weekLabel,
          weekStart,
          weekEnd,
          transactions: weekTransactions.sort((a, b) => 
            new Date(b.date).getTime() - new Date(a.date).getTime()
          ),
          income: weekIncome,
          expense: weekExpense,
        });
      }
    }

    return groups;
  }, [currencyTransactions, t]);

  const visibleWeekGroups = weekGroups.slice(0, visibleWeeks);
  const hasMoreWeeks = visibleWeeks < weekGroups.length;

  const loadMoreWeeks = () => {
    setVisibleWeeks(prev => Math.min(prev + 1, weekGroups.length));
  };

  return (
    <div 
      className="bg-card rounded-xl border border-border p-5 shadow-card animate-slide-up hover:shadow-lg transition-all duration-300"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg gradient-primary flex items-center justify-center text-primary-foreground font-bold">
            {CURRENCY_SYMBOLS[currency]}
          </div>
          <span className="font-semibold text-foreground">{t(getCurrencyTranslationKey(currency))}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-success">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm">{t('income')}</span>
          </div>
          <span className="font-semibold text-success">
            +{formatAmount(income)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-destructive">
            <TrendingDown className="w-4 h-4" />
            <span className="text-sm">{t('expenses')}</span>
          </div>
          <span className="font-semibold text-destructive">
            -{formatAmount(expense)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>

        <div className="h-px bg-border my-2" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">{t('balance')}</span>
          </div>
          <span className={cn(
            'text-lg font-bold',
            balance >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {formatAmount(balance)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>
      </div>

      {/* History Toggle Button */}
      {currencyTransactions.length > 0 && (
        <>
          <div className="h-px bg-border my-3" />
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setShowHistory(!showHistory);
              if (!showHistory) {
                setVisibleWeeks(1);
              }
            }}
            className="w-full justify-center text-muted-foreground hover:text-foreground"
          >
            {showHistory ? (
              <>
                <ChevronUp className="w-4 h-4 mr-2" />
                {t('hideHistory')}
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4 mr-2" />
                {t('showHistory')}
              </>
            )}
          </Button>

          {/* Expandable History by Weeks */}
          {showHistory && (
            <div className="mt-3 space-y-4 animate-fade-in">
              {visibleWeekGroups.map((group, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border pb-1">
                    <span className="font-medium">{group.weekLabel}</span>
                    <span>
                      {format(group.weekStart, 'd MMM', { locale: getLocale() })} - {format(group.weekEnd, 'd MMM', { locale: getLocale() })}
                    </span>
                  </div>
                  
                  {group.transactions.length > 0 ? (
                    <div className="space-y-1">
                      {group.transactions.map((transaction) => (
                        <div 
                          key={transaction.id} 
                          className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/50"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {transaction.type === 'income' ? (
                              <TrendingUp className="w-3 h-3 text-success flex-shrink-0" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-destructive flex-shrink-0" />
                            )}
                            <span className="truncate text-xs">
                              {getCategoryName ? getCategoryName(transaction.category) : transaction.category}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(transaction.date), 'd.MM', { locale: getLocale() })}
                            </span>
                            <span className={cn(
                              'text-xs font-medium',
                              transaction.type === 'income' ? 'text-success' : 'text-destructive'
                            )}>
                              {transaction.type === 'income' ? '+' : '-'}
                              {formatAmount(transaction.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                      
                      {/* Week totals */}
                      <div className="flex items-center justify-end gap-3 text-xs pt-1 border-t border-border/50">
                        {group.income > 0 && (
                          <span className="text-success">+{formatAmount(group.income)}</span>
                        )}
                        {group.expense > 0 && (
                          <span className="text-destructive">-{formatAmount(group.expense)}</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic py-1">
                      {t('noTransactionsThisWeek')}
                    </p>
                  )}
                </div>
              ))}

              {/* Load More Button */}
              {hasMoreWeeks && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    loadMoreWeeks();
                  }}
                  className="w-full text-xs"
                >
                  <ChevronDown className="w-3 h-3 mr-1" />
                  {t('loadMore')}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
