import { format } from 'date-fns';
import { pl, ru, enUS, uk } from 'date-fns/locale';
import { Transaction, CURRENCY_SYMBOLS } from '@/types/transaction';
import { Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';

interface TransactionListProps {
  transactions: Transaction[];
  onDelete: (id: string) => void;
  getCategoryName: (id: string) => string;
}

export const TransactionList = ({ transactions, onDelete, getCategoryName }: TransactionListProps) => {
  const { t, language } = useTranslation();

  const getLocale = () => {
    switch (language) {
      case 'pl': return pl;
      case 'ru': return ru;
      case 'uk': return uk;
      default: return enUS;
    }
  };

  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">{t('noTransactions')}</p>
        <p className="text-sm mt-1">{t('addFirstTransaction')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {transactions.map((transaction, index) => (
        <div
          key={transaction.id}
          className="flex items-center justify-between p-4 bg-card rounded-xl border border-border shadow-card animate-slide-up hover:shadow-md transition-all duration-200"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-center gap-4">
            <div className={cn(
              'p-2.5 rounded-xl',
              transaction.type === 'income' 
                ? 'bg-success/10 text-success' 
                : 'bg-destructive/10 text-destructive'
            )}>
              {transaction.type === 'income' ? (
                <TrendingUp className="w-5 h-5" />
              ) : (
                <TrendingDown className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="font-semibold text-foreground">
                {getCategoryName(transaction.category)}
              </p>
              {transaction.description && (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {transaction.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {format(transaction.date, 'd MMMM yyyy', { locale: getLocale() })}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <span className={cn(
              'text-lg font-bold',
              transaction.type === 'income' ? 'text-success' : 'text-destructive'
            )}>
              {transaction.type === 'income' ? '+' : '-'}
              {transaction.amount.toLocaleString(undefined, { 
                minimumFractionDigits: 2, 
                maximumFractionDigits: 2 
              })} {CURRENCY_SYMBOLS[transaction.currency]}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDelete(transaction.id)}
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
