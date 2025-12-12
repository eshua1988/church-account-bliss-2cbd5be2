export type TransactionType = 'income' | 'expense';

export type Currency = 'RUB' | 'USD' | 'EUR' | 'UAH' | 'BYN';

export type TransactionCategory = 
  | 'tithe' 
  | 'offering' 
  | 'donation' 
  | 'building_fund'
  | 'missions'
  | 'salaries'
  | 'utilities'
  | 'maintenance'
  | 'supplies'
  | 'charity'
  | 'other';

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  currency: Currency;
  category: TransactionCategory;
  description: string;
  date: Date;
  createdAt: Date;
}

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  UAH: '₴',
  BYN: 'Br',
};

export const CURRENCY_NAMES: Record<Currency, string> = {
  RUB: 'Российский рубль',
  USD: 'Доллар США',
  EUR: 'Евро',
  UAH: 'Украинская гривна',
  BYN: 'Белорусский рубль',
};

export const CATEGORY_NAMES: Record<TransactionCategory, string> = {
  tithe: 'Десятина',
  offering: 'Пожертвование',
  donation: 'Дар',
  building_fund: 'Фонд строительства',
  missions: 'Миссии',
  salaries: 'Зарплаты',
  utilities: 'Коммунальные услуги',
  maintenance: 'Обслуживание',
  supplies: 'Расходные материалы',
  charity: 'Благотворительность',
  other: 'Прочее',
};

export const INCOME_CATEGORIES: TransactionCategory[] = [
  'tithe',
  'offering',
  'donation',
  'building_fund',
  'missions',
  'other',
];

export const EXPENSE_CATEGORIES: TransactionCategory[] = [
  'salaries',
  'utilities',
  'maintenance',
  'supplies',
  'charity',
  'missions',
  'other',
];
