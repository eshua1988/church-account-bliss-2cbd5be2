export type DepositCurrency = 'PLN' | 'USD' | 'EUR' | 'UAH';

const ONES = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć'];
const TEENS = ['dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
const TENS = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
const HUNDREDS = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];

const CURRENCY_FORMS: Record<DepositCurrency, [string, string, string]> = {
  PLN: ['złoty', 'złote', 'złotych'],
  USD: ['dolar amerykański', 'dolary amerykańskie', 'dolarów amerykańskich'],
  EUR: ['euro', 'euro', 'euro'],
  UAH: ['hrywna', 'hrywny', 'hrywien'],
};

const formIndex = (value: number) => {
  const lastTwo = value % 100;
  if (lastTwo >= 12 && lastTwo <= 14) return 2;
  const last = value % 10;
  if (last === 1) return 0;
  if (last >= 2 && last <= 4) return 1;
  return 2;
};

const tripletToWords = (value: number) => {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]);
  else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) words.push(TENS[tens]);
    if (ones) words.push(ONES[ones]);
  }
  return words.join(' ');
};

export const amountInPolishWords = (amount: number, currency: DepositCurrency) => {
  const safeAmount = Number.isFinite(amount) && amount >= 0 ? Math.min(amount, 999_999_999.99) : 0;
  const rounded = Math.round(safeAmount * 100);
  const whole = Math.floor(rounded / 100);
  const cents = rounded % 100;
  const millions = Math.floor(whole / 1_000_000);
  const thousands = Math.floor((whole % 1_000_000) / 1000);
  const remainder = whole % 1000;
  const words: string[] = [];

  if (millions) {
    words.push(tripletToWords(millions), ['milion', 'miliony', 'milionów'][formIndex(millions)]);
  }
  if (thousands) {
    if (thousands === 1) words.push('tysiąc');
    else words.push(tripletToWords(thousands), ['tysiąc', 'tysiące', 'tysięcy'][formIndex(thousands)]);
  }
  if (remainder) words.push(tripletToWords(remainder));
  if (!whole) words.push('zero');
  words.push(CURRENCY_FORMS[currency][formIndex(whole)]);

  return `${words.join(' ')} ${String(cents).padStart(2, '0')}/100`;
};
