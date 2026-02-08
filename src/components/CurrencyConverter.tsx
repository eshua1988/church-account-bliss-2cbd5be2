import { useState, useEffect } from 'react';
import { ArrowRightLeft, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Language = 'pl' | 'ru' | 'en' | 'uk';

const translations: Record<Language, Record<string, string>> = {
  pl: {
    title: 'Konwertuj walutę',
    from: 'Z waluty',
    to: 'Na walutę',
    amount: 'Kwota',
    result: 'Wynik',
    apply: 'Zastosuj',
    cancel: 'Anuluj',
    loading: 'Ładowanie kursów...',
    error: 'Błąd ładowania kursów',
    rate: 'Kurs',
  },
  ru: {
    title: 'Конвертировать валюту',
    from: 'Из валюты',
    to: 'В валюту',
    amount: 'Сумма',
    result: 'Результат',
    apply: 'Применить',
    cancel: 'Отмена',
    loading: 'Загрузка курсов...',
    error: 'Ошибка загрузки курсов',
    rate: 'Курс',
  },
  en: {
    title: 'Convert currency',
    from: 'From currency',
    to: 'To currency',
    amount: 'Amount',
    result: 'Result',
    apply: 'Apply',
    cancel: 'Cancel',
    loading: 'Loading rates...',
    error: 'Failed to load rates',
    rate: 'Rate',
  },
  uk: {
    title: 'Конвертувати валюту',
    from: 'З валюти',
    to: 'У валюту',
    amount: 'Сума',
    result: 'Результат',
    apply: 'Застосувати',
    cancel: 'Скасувати',
    loading: 'Завантаження курсів...',
    error: 'Помилка завантаження курсів',
    rate: 'Курс',
  },
};

const currencies = [
  { value: 'PLN', label: 'zł', name: 'Złoty' },
  { value: 'EUR', label: '€', name: 'Euro' },
  { value: 'USD', label: '$', name: 'Dollar' },
  { value: 'UAH', label: '₴', name: 'Hryvnia' },
  { value: 'RUB', label: '₽', name: 'Ruble' },
  { value: 'BYN', label: 'Br', name: 'BYN' },
];

// Static exchange rates (approximate, relative to USD)
const staticRates: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  PLN: 4.0,
  UAH: 41.5,
  RUB: 96.0,
  BYN: 3.27,
};

interface CurrencyConverterProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (amount: string, currency: string) => void;
  currentAmount: string;
  currentCurrency: string;
  language: Language | string;
}

export const CurrencyConverter = ({
  isOpen,
  onClose,
  onApply,
  currentAmount,
  currentCurrency,
  language,
}: CurrencyConverterProps) => {
  const lang = (language in translations ? language : 'en') as Language;
  const t = translations[lang];
  
  const [fromCurrency, setFromCurrency] = useState(currentCurrency !== 'PLN' ? currentCurrency : 'EUR');
  const [toCurrency, setToCurrency] = useState(currentCurrency);
  const [amount, setAmount] = useState(currentAmount || '');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>(staticRates);

  // Initialize with opposite currencies
  useEffect(() => {
    if (isOpen) {
      setToCurrency(currentCurrency);
      setFromCurrency(currentCurrency === 'PLN' ? 'EUR' : (currentCurrency === 'EUR' ? 'USD' : 'EUR'));
      setAmount('');
      setResult('');
    }
  }, [isOpen, currentCurrency]);

  // Calculate result when inputs change
  useEffect(() => {
    if (amount && fromCurrency && toCurrency && !isNaN(parseFloat(amount))) {
      const fromRate = rates[fromCurrency] || 1;
      const toRate = rates[toCurrency] || 1;
      // Convert to USD first, then to target currency
      const usdAmount = parseFloat(amount) / fromRate;
      const convertedAmount = usdAmount * toRate;
      setResult(convertedAmount.toFixed(2));
    } else {
      setResult('');
    }
  }, [amount, fromCurrency, toCurrency, rates]);

  const handleSwapCurrencies = () => {
    const temp = fromCurrency;
    setFromCurrency(toCurrency);
    setToCurrency(temp);
  };

  const handleApply = () => {
    if (result) {
      onApply(result, toCurrency);
      onClose();
    }
  };

  const getExchangeRate = () => {
    const fromRate = rates[fromCurrency] || 1;
    const toRate = rates[toCurrency] || 1;
    return (toRate / fromRate).toFixed(4);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5" />
            {t.title}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span>{t.loading}</span>
            </div>
          ) : (
            <>
              {/* From Currency & Amount */}
              <div className="space-y-2">
                <Label>{t.from}</Label>
                <div className="flex gap-2">
                  <Select value={fromCurrency} onValueChange={setFromCurrency}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label} {c.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Swap Button */}
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleSwapCurrencies}
                  className="rounded-full"
                >
                  <ArrowRightLeft className="w-4 h-4" />
                </Button>
              </div>

              {/* To Currency & Result */}
              <div className="space-y-2">
                <Label>{t.to}</Label>
                <div className="flex gap-2">
                  <Select value={toCurrency} onValueChange={setToCurrency}>
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label} {c.value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="text"
                    value={result}
                    readOnly
                    className="flex-1 bg-muted font-semibold"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Exchange Rate Display */}
              {amount && result && (
                <div className="text-sm text-muted-foreground text-center py-2 border-t">
                  {t.rate}: 1 {fromCurrency} = {getExchangeRate()} {toCurrency}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                >
                  {t.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={handleApply}
                  disabled={!result}
                  className="flex-1"
                >
                  {t.apply}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
