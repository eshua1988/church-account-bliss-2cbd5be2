import { useState, useCallback, useEffect } from 'react';

export type Language = 'pl' | 'ru' | 'en' | 'uk';

export const LANGUAGE_NAMES: Record<Language, string> = {
  pl: 'Polski',
  ru: 'Русский',
  en: 'English',
  uk: 'Українська',
};

const STORAGE_KEY = 'church_language';

export const translations = {
  // Header
  appTitle: {
    pl: 'Księgowość kościelna',
    ru: 'Церковная бухгалтерия',
    en: 'Church Accounting',
    uk: 'Церковна бухгалтерія',
  },
  appSubtitle: {
    pl: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    ru: 'ОБЩИНА ХРИСТИАН БАПТИСТОВ «БОЖЬЯ БЛАГОДАТЬ» В ВАРШАВЕ',
    en: 'CONGREGATION OF CHRISTIAN BAPTISTS «GOD\'S GRACE» IN WARSAW',
    uk: 'ГРОМАДА ХРИСТИЯН БАПТИСТІВ «БОЖА БЛАГОДАТЬ» У ВАРШАВІ',
  },

  // Stats
  balance: {
    pl: 'Saldo',
    ru: 'Баланс',
    en: 'Balance',
    uk: 'Баланс',
  },
  income: {
    pl: 'Przychody',
    ru: 'Доходы',
    en: 'Income',
    uk: 'Доходи',
  },
  expenses: {
    pl: 'Wydatki',
    ru: 'Расходы',
    en: 'Expenses',
    uk: 'Витрати',
  },
  totalOperations: {
    pl: 'Liczba operacji',
    ru: 'Всего операций',
    en: 'Total Operations',
    uk: 'Всього операцій',
  },

  // Overview
  financialOverview: {
    pl: 'Przegląd finansów',
    ru: 'Обзор финансов',
    en: 'Financial Overview',
    uk: 'Огляд фінансів',
  },
  mainCurrency: {
    pl: 'Główna waluta wyświetlania',
    ru: 'Основная валюта для отображения',
    en: 'Main display currency',
    uk: 'Основна валюта для відображення',
  },
  balanceByCurrency: {
    pl: 'Saldo według walut',
    ru: 'Баланс по валютам',
    en: 'Balance by Currency',
    uk: 'Баланс за валютами',
  },

  // Transactions
  recentOperations: {
    pl: 'Ostatnie operacje',
    ru: 'Последние операции',
    en: 'Recent Operations',
    uk: 'Останні операції',
  },
  addTransaction: {
    pl: 'Dodaj transakcję',
    ru: 'Добавить транзакцию',
    en: 'Add Transaction',
    uk: 'Додати транзакцію',
  },
  newTransaction: {
    pl: 'Nowa transakcja',
    ru: 'Новая транзакция',
    en: 'New Transaction',
    uk: 'Нова транзакція',
  },
  noTransactions: {
    pl: 'Brak transakcji',
    ru: 'Нет транзакций',
    en: 'No transactions',
    uk: 'Немає транзакцій',
  },
  addFirstTransaction: {
    pl: 'Dodaj pierwszą transakcję, aby rozpocząć',
    ru: 'Добавьте первую транзакцию, чтобы начать',
    en: 'Add your first transaction to get started',
    uk: 'Додайте першу транзакцію, щоб почати',
  },
  expense: {
    pl: 'Wydatek',
    ru: 'Расход',
    en: 'Expense',
    uk: 'Витрата',
  },
  incomeType: {
    pl: 'Przychód',
    ru: 'Доход',
    en: 'Income',
    uk: 'Дохід',
  },

  // Categories
  categories: {
    pl: 'Ustawienia',
    ru: 'Настройки',
    en: 'Settings',
    uk: 'Налаштування',
  },
  categoryManagement: {
    pl: 'Zarządzanie kategoriami',
    ru: 'Управление категориями',
    en: 'Category Management',
    uk: 'Керування категоріями',
  },
  addCategory: {
    pl: 'Dodaj kategorię',
    ru: 'Добавить категорию',
    en: 'Add Category',
    uk: 'Додати категорію',
  },
  categoryName: {
    pl: 'Nazwa kategorii...',
    ru: 'Название категории...',
    en: 'Category name...',
    uk: 'Назва категорії...',
  },
  incomeCategories: {
    pl: 'Kategorie przychodów',
    ru: 'Категории доходов',
    en: 'Income Categories',
    uk: 'Категорії доходів',
  },
  expenseCategories: {
    pl: 'Kategorie wydatków',
    ru: 'Категории расходов',
    en: 'Expense Categories',
    uk: 'Категорії витрат',
  },
  noCategories: {
    pl: 'Brak kategorii',
    ru: 'Нет категорий',
    en: 'No categories',
    uk: 'Немає категорій',
  },

  // Form
  amount: {
    pl: 'Kwota',
    ru: 'Сумма',
    en: 'Amount',
    uk: 'Сума',
  },
  currency: {
    pl: 'Waluta',
    ru: 'Валюта',
    en: 'Currency',
    uk: 'Валюта',
  },
  category: {
    pl: 'Nazwa działu',
    ru: 'Название отдела',
    en: 'Department name',
    uk: 'Назва відділу',
  },
  selectCategory: {
    pl: 'Wybierz kategorię',
    ru: 'Выберите категорию',
    en: 'Select category',
    uk: 'Виберіть категорію',
  },
  date: {
    pl: 'Data',
    ru: 'Дата',
    en: 'Date',
    uk: 'Дата',
  },
  description: {
    pl: 'Opis (opcjonalnie)',
    ru: 'Описание (необязательно)',
    en: 'Description (optional)',
    uk: 'Опис (необов\'язково)',
  },
  addDescription: {
    pl: 'Dodaj opis...',
    ru: 'Добавьте описание...',
    en: 'Add description...',
    uk: 'Додайте опис...',
  },
  addIncome: {
    pl: 'Dodaj przychód',
    ru: 'Добавить доход',
    en: 'Add Income',
    uk: 'Додати дохід',
  },
  addExpense: {
    pl: 'Dodaj wydatek',
    ru: 'Добавить расход',
    en: 'Add Expense',
    uk: 'Додати витрату',
  },
  noCategoriesWarning: {
    pl: 'Brak kategorii. Dodaj kategorię w ustawieniach.',
    ru: 'Нет категорий. Добавьте категорию в настройках.',
    en: 'No categories. Add a category in settings.',
    uk: 'Немає категорій. Додайте категорію в налаштуваннях.',
  },

  // Toasts
  incomeAdded: {
    pl: 'Przychód dodany',
    ru: 'Доход добавлен',
    en: 'Income added',
    uk: 'Дохід додано',
  },
  expenseAdded: {
    pl: 'Wydatek dodany',
    ru: 'Расход добавлен',
    en: 'Expense added',
    uk: 'Витрату додано',
  },
  transactionDeleted: {
    pl: 'Transakcja usunięta',
    ru: 'Транзакция удалена',
    en: 'Transaction deleted',
    uk: 'Транзакцію видалено',
  },
  categoryAdded: {
    pl: 'Kategoria dodana',
    ru: 'Категория добавлена',
    en: 'Category added',
    uk: 'Категорію додано',
  },
  categoryDeleted: {
    pl: 'Kategoria usunięta',
    ru: 'Категория удалена',
    en: 'Category deleted',
    uk: 'Категорію видалено',
  },
  unknown: {
    pl: 'Nieznane',
    ru: 'Неизвестно',
    en: 'Unknown',
    uk: 'Невідомо',
  },

  // Undo/Redo
  undo: {
    pl: 'Cofnij',
    ru: 'Отменить',
    en: 'Undo',
    uk: 'Скасувати',
  },
  redo: {
    pl: 'Ponów',
    ru: 'Повторить',
    en: 'Redo',
    uk: 'Повторити',
  },
  actionUndone: {
    pl: 'Akcja cofnięta',
    ru: 'Действие отменено',
    en: 'Action undone',
    uk: 'Дію скасовано',
  },
  actionRedone: {
    pl: 'Akcja powtórzona',
    ru: 'Действие повторено',
    en: 'Action redone',
    uk: 'Дію повторено',
  },

  // Charts
  statistics: {
    pl: 'Statystyki',
    ru: 'Статистика',
    en: 'Statistics',
    uk: 'Статистика',
  },
  categoryDistribution: {
    pl: 'Rozkład według kategorii',
    ru: 'Распределение по категориям',
    en: 'Category Distribution',
    uk: 'Розподіл за категоріями',
  },
  balanceOverTime: {
    pl: 'Saldo w czasie',
    ru: 'Баланс во времени',
    en: 'Balance Over Time',
    uk: 'Баланс у часі',
  },
  incomeVsExpenses: {
    pl: 'Przychody vs Wydatki',
    ru: 'Доходы vs Расходы',
    en: 'Income vs Expenses',
    uk: 'Доходи vs Витрати',
  },
  
  // Currency settings
  currencySettings: {
    pl: 'Ustawienia walut',
    ru: 'Настройки валют',
    en: 'Currency Settings',
    uk: 'Налаштування валют',
  },
  selectVisibleCurrencies: {
    pl: 'Wybierz waluty do wyświetlenia',
    ru: 'Выберите валюты для отображения',
    en: 'Select currencies to display',
    uk: 'Виберіть валюти для відображення',
  },
  settings: {
    pl: 'Ustawienia',
    ru: 'Настройки',
    en: 'Settings',
    uk: 'Налаштування',
  },

  // Currency names
  currencyRUB: {
    pl: 'Rubel rosyjski',
    ru: 'Российский рубль',
    en: 'Russian Ruble',
    uk: 'Російський рубль',
  },
  currencyUSD: {
    pl: 'Dolar amerykański',
    ru: 'Доллар США',
    en: 'US Dollar',
    uk: 'Долар США',
  },
  currencyEUR: {
    pl: 'Euro',
    ru: 'Евро',
    en: 'Euro',
    uk: 'Євро',
  },
  currencyUAH: {
    pl: 'Hrywna ukraińska',
    ru: 'Украинская гривна',
    en: 'Ukrainian Hryvnia',
    uk: 'Українська гривня',
  },
  currencyBYN: {
    pl: 'Rubel białoruski',
    ru: 'Белорусский рубль',
    en: 'Belarusian Ruble',
    uk: 'Білоруський рубль',
  },
  currencyPLN: {
    pl: 'Złoty polski',
    ru: 'Польский злотый',
    en: 'Polish Zloty',
    uk: 'Польський злотий',
  },

  // Default categories
  catTithe: {
    pl: 'Dziesięcina',
    ru: 'Десятина',
    en: 'Tithe',
    uk: 'Десятина',
  },
  catOffering: {
    pl: 'Ofiara',
    ru: 'Пожертвование',
    en: 'Offering',
    uk: 'Пожертва',
  },
  catDonation: {
    pl: 'Darowizna',
    ru: 'Дар',
    en: 'Donation',
    uk: 'Дар',
  },
  catBuildingFund: {
    pl: 'Fundusz budowlany',
    ru: 'Фонд строительства',
    en: 'Building Fund',
    uk: 'Фонд будівництва',
  },
  catMissions: {
    pl: 'Misje',
    ru: 'Миссии',
    en: 'Missions',
    uk: 'Місії',
  },
  catOther: {
    pl: 'Inne',
    ru: 'Прочее',
    en: 'Other',
    uk: 'Інше',
  },
  catSalaries: {
    pl: 'Wynagrodzenia',
    ru: 'Зарплаты',
    en: 'Salaries',
    uk: 'Зарплати',
  },
  catUtilities: {
    pl: 'Media',
    ru: 'Коммунальные услуги',
    en: 'Utilities',
    uk: 'Комунальні послуги',
  },
  catMaintenance: {
    pl: 'Konserwacja',
    ru: 'Обслуживание',
    en: 'Maintenance',
    uk: 'Обслуговування',
  },
  catSupplies: {
    pl: 'Materiały',
    ru: 'Расходные материалы',
    en: 'Supplies',
    uk: 'Витратні матеріали',
  },
  catCharity: {
    pl: 'Działalność charytatywna',
    ru: 'Благотворительность',
    en: 'Charity',
    uk: 'Благодійність',
  },

  // Expense document fields
  issuedTo: {
    pl: 'Wydano (imię nazwisko)',
    ru: 'Выдано (ФИО)',
    en: 'Issued to (full name)',
    uk: 'Видано (ПІБ)',
  },
  decisionNumber: {
    pl: 'Podstawa (na jakie potrzeby)',
    ru: 'Основание (для каких потребностей)',
    en: 'Basis (for what needs)',
    uk: 'Підстава (для яких потреб)',
  },
  amountInWords: {
    pl: 'Kwota słownie',
    ru: 'Сумма прописью',
    en: 'Amount in words',
    uk: 'Сума прописом',
  },
  cashierName: {
    pl: 'Kasjer',
    ru: 'Кассир',
    en: 'Cashier',
    uk: 'Касир',
  },
  enterIssuedTo: {
    pl: 'Wpisz imię i nazwisko...',
    ru: 'Введите ФИО...',
    en: 'Enter full name...',
    uk: 'Введіть ПІБ...',
  },
  enterDecisionNumber: {
    pl: 'Wpisz numer decyzji...',
    ru: 'Введите номер решения...',
    en: 'Enter decision number...',
    uk: 'Введіть номер рішення...',
  },
  enterAmountInWords: {
    pl: 'Wpisz kwotę słownie...',
    ru: 'Введите сумму прописью...',
    en: 'Enter amount in words...',
    uk: 'Введіть суму прописом...',
  },
  enterCashierName: {
    pl: 'Wpisz imię kasjera...',
    ru: 'Введите имя кассира...',
    en: 'Enter cashier name...',
    uk: 'Введіть ім\'я касира...',
  },
  expenseDocumentFields: {
    pl: 'Dane dokumentu wydatku',
    ru: 'Данные документа расхода',
    en: 'Expense document details',
    uk: 'Дані документа витрати',
  },
  importPayout: {
    pl: 'Importuj Dowód wypłaty',
    ru: 'Импортировать документ',
    en: 'Import payout (PDF)',
    uk: 'Імпортувати документ виплати',
  },
  importSuccess: {
    pl: 'Dowód zaimportowany',
    ru: 'Документ импортирован',
    en: 'Payout imported',
    uk: 'Документ імпортовано',
  },
  importError: {
    pl: 'Błąd importu',
    ru: 'Ошибка импорта',
    en: 'Import error',
    uk: 'Помилка імпорту',
  },
  importFailedParse: {
    pl: 'Nie można odczytać pliku PDF. Sprawdź poprawność pliku.',
    ru: 'Не удалось распарсить PDF. Проверьте файл.',
    en: 'Failed to parse PDF. Please check the file.',
    uk: 'Не вдалося розпарсити PDF. Перевірте файл.',
  },
  importDocument: {
    pl: 'Importuj dokument',
    ru: 'Импортировать документ',
    en: 'Import document',
    uk: 'Імпортувати документ',
  },
  importPreviewTitle: {
    pl: 'Podgląd importu',
    ru: 'Предпросмотр импорта',
    en: 'Import preview',
    uk: 'Попередній перегляд імпорту',
  },
  importConfirm: {
    pl: 'Zaimportuj',
    ru: 'Импортировать',
    en: 'Import',
    uk: 'Імпортувати',
  },
  importCancel: {
    pl: 'Anuluj',
    ru: 'Отмена',
    en: 'Cancel',
    uk: 'Скасувати',
  },
  // Statistics table
  allTime: {
    pl: 'Cały okres',
    ru: 'За все время',
    en: 'All time',
    uk: 'За весь час',
  },
  thisMonth: {
    pl: 'Ten miesiąc',
    ru: 'Этот месяц',
    en: 'This month',
    uk: 'Цей місяць',
  },
  lastMonth: {
    pl: 'Poprzedni miesiąc',
    ru: 'Прошлый месяц',
    en: 'Last month',
    uk: 'Минулий місяць',
  },
  last3Months: {
    pl: 'Ostatnie 3 miesiące',
    ru: 'Последние 3 месяца',
    en: 'Last 3 months',
    uk: 'Останні 3 місяці',
  },
  last6Months: {
    pl: 'Ostatnie 6 miesięcy',
    ru: 'Последние 6 месяцев',
    en: 'Last 6 months',
    uk: 'Останні 6 місяців',
  },
  thisYear: {
    pl: 'Ten rok',
    ru: 'Этот год',
    en: 'This year',
    uk: 'Цей рік',
  },
  transactionsTable: {
    pl: 'Tabela transakcji',
    ru: 'Таблица транзакций',
    en: 'Transactions table',
    uk: 'Таблиця транзакцій',
  },
  type: {
    pl: 'Typ',
    ru: 'Тип',
    en: 'Type',
    uk: 'Тип',
  },
  showingTransactions: {
    pl: 'Pokazywane transakcje',
    ru: 'Показано транзакций',
    en: 'Showing transactions',
    uk: 'Показано транзакцій',
  },
  categoryUpdated: {
    pl: 'Kategoria zaktualizowana',
    ru: 'Категория обновлена',
    en: 'Category updated',
    uk: 'Категорію оновлено',
  },
  timeRange: {
    pl: 'Okres czasu',
    ru: 'Период времени',
    en: 'Time period',
    uk: 'Період часу',
  },
  apply: {
    pl: 'Zastosuj',
    ru: 'Применить',
    en: 'Apply',
    uk: 'Застосувати',
  },
  reset: {
    pl: 'Wyczyść',
    ru: 'Сбросить',
    en: 'Reset',
    uk: 'Очистити',
  },
  singleDate: {
    pl: 'Pojedyncza data',
    ru: 'Одна дата',
    en: 'Single date',
    uk: 'Одна дата',
  },
  rangeMode: {
    pl: 'Okres',
    ru: 'Период',
    en: 'Range',
    uk: 'Період',
  },
  export: {
    pl: 'Eksportuj',
    ru: 'Экспортировать',
    en: 'Export',
    uk: 'Експортувати',
  },
  
  // Payout Generator
  payoutGenerator: {
    pl: 'Generator dowodu',
    ru: 'Генератор документа',
    en: 'Payout Generator',
    uk: 'Генератор документа',
  },
  payoutGeneratorTitle: {
    pl: 'Generator Dowód wypłaty',
    ru: 'Генератор Dowód wypłaty',
    en: 'Payout Voucher Generator',
    uk: 'Генератор Dowód wypłaty',
  },
  requiredFields: {
    pl: 'Pola obowiązkowe do wypełnienia',
    ru: 'Обязательные поля для заполнения',
    en: 'Required fields',
    uk: 'Обов\'язкові поля для заповнення',
  },
  payoutIssuedTo: {
    pl: 'Wydano (imię i nazwisko)',
    ru: 'Выдано (имя и фамилия)',
    en: 'Issued to (full name)',
    uk: 'Видано (ім\'я та прізвище)',
  },
  payoutBankAccount: {
    pl: 'Konto do przelewu (numer telefonu lub konto bankowe)',
    ru: 'Счет для перевода (номер телефона или банковский счет)',
    en: 'Transfer account (phone number or bank account)',
    uk: 'Рахунок для переказу (номер телефону або банківський рахунок)',
  },
  payoutBankAccountPlaceholder: {
    pl: 'Wpisz numer konta lub telefonu...',
    ru: 'Введите номер счета или телефона...',
    en: 'Enter account or phone number...',
    uk: 'Введіть номер рахунку або телефону...',
  },
  payoutDepartmentName: {
    pl: 'Nazwa oddziału',
    ru: 'Название отдела',
    en: 'Department name',
    uk: 'Назва відділу',
  },
  payoutDepartmentPlaceholder: {
    pl: 'Wpisz nazwę oddziału...',
    ru: 'Введите название отдела...',
    en: 'Enter department name...',
    uk: 'Введіть назву відділу...',
  },
  payoutBasis: {
    pl: 'Podstawa (na jakie potrzeby)',
    ru: 'Основание (для каких потребностей)',
    en: 'Basis (for what needs)',
    uk: 'Підстава (для яких потреб)',
  },
  payoutBasisPlaceholder: {
    pl: 'Wpisz podstawę wypłaty...',
    ru: 'Введите основание выплаты...',
    en: 'Enter payout basis...',
    uk: 'Введіть підставу виплати...',
  },
  payoutSignature: {
    pl: 'Podpis odbiorcy',
    ru: 'Подпись получателя',
    en: 'Recipient signature',
    uk: 'Підпис отримувача',
  },
  payoutClearSignature: {
    pl: 'Wyczyść',
    ru: 'Очистить',
    en: 'Clear',
    uk: 'Очистити',
  },
  payoutGeneratePDF: {
    pl: 'Generuj PDF',
    ru: 'Сгенерировать PDF',
    en: 'Generate PDF',
    uk: 'Згенерувати PDF',
  },
  payoutGenerateAndSave: {
    pl: 'Generuj i zapisz',
    ru: 'Сгенерировать и сохранить',
    en: 'Generate and Save',
    uk: 'Згенерувати і зберегти',
  },
  transactionSaved: {
    pl: 'Transakcja zapisana',
    ru: 'Транзакция сохранена',
    en: 'Transaction saved',
    uk: 'Транзакцію збережено',
  },
  showHistory: {
    pl: 'Pokaż historię',
    ru: 'Показать историю',
    en: 'Show history',
    uk: 'Показати історію',
  },
  hideHistory: {
    pl: 'Ukryj historię',
    ru: 'Скрыть историю',
    en: 'Hide history',
    uk: 'Сховати історію',
  },
  thisWeek: {
    pl: 'Ten tydzień',
    ru: 'Эта неделя',
    en: 'This week',
    uk: 'Цей тиждень',
  },
  previousWeek: {
    pl: 'Poprzedni tydzień',
    ru: 'Предыдущая неделя',
    en: 'Previous week',
    uk: 'Попередній тиждень',
  },
  weeksAgo: {
    pl: 'tygodni temu',
    ru: 'недель назад',
    en: 'weeks ago',
    uk: 'тижнів тому',
  },
  loadMore: {
    pl: 'Załaduj więcej',
    ru: 'Загрузить ещё',
    en: 'Load more',
    uk: 'Завантажити ще',
  },
  noTransactionsThisWeek: {
    pl: 'Brak transakcji w tym tygodniu',
    ru: 'Нет транзакций за эту неделю',
    en: 'No transactions this week',
    uk: 'Немає транзакцій за цей тиждень',
  },
  convertCurrency: {
    pl: 'Konwertuj walutę',
    ru: 'Конвертировать валюту',
    en: 'Convert currency',
    uk: 'Конвертувати валюту',
  },
} as const;

export type TranslationKey = keyof typeof translations;

export const useLanguage = () => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ['pl', 'ru', 'en', 'uk'].includes(stored)) {
        return stored as Language;
      }
    } catch (e) {
      console.error('Failed to load language:', e);
    }
    return 'ru'; // Default to Russian
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {
      console.error('Failed to save language:', e);
    }
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[key]?.[language] || key;
  }, [language]);

  const getDateLocale = useCallback(() => {
    switch (language) {
      case 'pl': return 'pl-PL';
      case 'ru': return 'ru-RU';
      case 'en': return 'en-US';
      case 'uk': return 'uk-UA';
      default: return 'pl-PL';
    }
  }, [language]);

  return {
    language,
    setLanguage,
    t,
    getDateLocale,
  };
};
