import { Currency, CURRENCY_SYMBOLS, CURRENCY_NAMES } from '@/types/transaction';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CurrencyBalanceCardProps {
  currency: Currency;
  income: number;
  expense: number;
  balance: number;
  delay?: number;
}

export const CurrencyBalanceCard = ({ 
  currency, 
  income, 
  expense, 
  balance,
  delay = 0 
}: CurrencyBalanceCardProps) => {
  const formatAmount = (amount: number) => {
    return amount.toLocaleString('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
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
          <span className="font-semibold text-foreground">{CURRENCY_NAMES[currency]}</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-success">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm">Доходы</span>
          </div>
          <span className="font-semibold text-success">
            +{formatAmount(income)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-destructive">
            <TrendingDown className="w-4 h-4" />
            <span className="text-sm">Расходы</span>
          </div>
          <span className="font-semibold text-destructive">
            -{formatAmount(expense)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>

        <div className="h-px bg-border my-2" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Баланс</span>
          </div>
          <span className={cn(
            'text-lg font-bold',
            balance >= 0 ? 'text-success' : 'text-destructive'
          )}>
            {formatAmount(balance)} {CURRENCY_SYMBOLS[currency]}
          </span>
        </div>
      </div>
    </div>
  );
};
