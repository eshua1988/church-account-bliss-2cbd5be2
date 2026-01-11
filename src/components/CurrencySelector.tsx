import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Currency, CURRENCY_NAMES, CURRENCY_SYMBOLS } from '@/types/transaction';

interface CurrencySelectorProps {
  value: Currency;
  onChange: (value: Currency) => void;
  className?: string;
  availableCurrencies?: Currency[];
}

const allCurrencies: Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'BYN', 'PLN'];

export const CurrencySelector = ({ value, onChange, className, availableCurrencies }: CurrencySelectorProps) => {
  const currencies = availableCurrencies && availableCurrencies.length > 0 ? availableCurrencies : allCurrencies;
  
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder="Выберите валюту" />
      </SelectTrigger>
      <SelectContent>
        {currencies.map((currency) => (
          <SelectItem key={currency} value={currency}>
            <span className="flex items-center gap-2">
              <span className="font-semibold text-primary">{CURRENCY_SYMBOLS[currency]}</span>
              <span>{CURRENCY_NAMES[currency]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
