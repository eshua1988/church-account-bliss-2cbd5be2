import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';
import { TrendingUp, TrendingDown, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';

interface CurrencyBalanceCardProps {
  currency: Currency;
  income: number;
  expense: number;
  balance: number;
  delay?: number;
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

export const CurrencyBalanceCard = ({ 
  currency, 
  income, 
  expense, 
  balance,
  delay = 0 
}: CurrencyBalanceCardProps) => {
  const { t, getDateLocale } = useTranslation();
  
  const formatAmount = (amount: number) => {
    return amount.toLocaleString(getDateLocale(), {
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
    </div>
  );
};
