import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Transaction, CURRENCY_SYMBOLS, CATEGORY_NAMES } from '@/types/transaction';
import { Trash2, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface TransactionListProps {
  transactions: Transaction[];
  onDelete: (id: string) => void;
}

export const TransactionList = ({ transactions, onDelete }: TransactionListProps) => {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">Нет транзакций</p>
        <p className="text-sm mt-1">Добавьте первую транзакцию, чтобы начать</p>
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
                {CATEGORY_NAMES[transaction.category]}
              </p>
              {transaction.description && (
                <p className="text-sm text-muted-foreground line-clamp-1">
                  {transaction.description}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {format(transaction.date, 'd MMMM yyyy', { locale: ru })}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <span className={cn(
              'text-lg font-bold',
              transaction.type === 'income' ? 'text-success' : 'text-destructive'
            )}>
              {transaction.type === 'income' ? '+' : '-'}
              {transaction.amount.toLocaleString('ru-RU', { 
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
