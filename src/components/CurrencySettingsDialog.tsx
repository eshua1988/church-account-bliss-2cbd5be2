import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';
import { useTranslation } from '@/contexts/LanguageContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const ALL_CURRENCIES: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];
const STORAGE_KEY = 'church_visible_currencies';

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

interface CurrencySettingsContentProps {
  visibleCurrencies: Currency[];
  onVisibleCurrenciesChange: (currencies: Currency[]) => void;
}

export const CurrencySettingsContent = ({ 
  visibleCurrencies, 
  onVisibleCurrenciesChange 
}: CurrencySettingsContentProps) => {
  const { t } = useTranslation();

  const toggleCurrency = (currency: Currency) => {
    if (visibleCurrencies.includes(currency)) {
      if (visibleCurrencies.length > 1) {
        onVisibleCurrenciesChange(visibleCurrencies.filter(c => c !== currency));
      }
    } else {
      onVisibleCurrenciesChange([...visibleCurrencies, currency]);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('selectVisibleCurrencies')}</p>
      {ALL_CURRENCIES.map((currency) => (
        <div key={currency} className="flex items-center space-x-3">
          <Checkbox
            id={`currency-${currency}`}
            checked={visibleCurrencies.includes(currency)}
            onCheckedChange={() => toggleCurrency(currency)}
            disabled={visibleCurrencies.length === 1 && visibleCurrencies.includes(currency)}
          />
          <Label 
            htmlFor={`currency-${currency}`}
            className="flex items-center gap-2 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center text-primary-foreground font-bold text-sm">
              {CURRENCY_SYMBOLS[currency]}
            </span>
            <span>{t(getCurrencyTranslationKey(currency))}</span>
          </Label>
        </div>
      ))}
    </div>
  );
};

export const loadVisibleCurrencies = (): Currency[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((c: string) => ALL_CURRENCIES.includes(c as Currency)) as Currency[];
      }
    }
  } catch (e) {
    console.error('Failed to load visible currencies:', e);
  }
  return ['PLN', 'EUR', 'USD'];
};

export const saveVisibleCurrencies = (currencies: Currency[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currencies));
  } catch (e) {
    console.error('Failed to save visible currencies:', e);
  }
};
