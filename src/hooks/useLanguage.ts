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
  telegramBot: {
    pl: 'Bot Telegram',
    ru: 'Telegram-бот',
    en: 'Telegram Bot',
    uk: 'Telegram-бот',
  },
  telegramBotDescription: {
    pl: 'Podłącz bota Telegram do wypełniania dokumentów, przeglądania wydatków i śledzenia',
    ru: 'Подключите Telegram-бот для заполнения документов, просмотра расходов и отслеживания',
    en: 'Connect Telegram bot for filling documents, viewing expenses and tracking',
    uk: 'Підключіть Telegram-бот для заповнення документів, перегляду витрат і відстеження',
  },
  connected: {
    pl: 'Połączono',
    ru: 'Подключен',
    en: 'Connected',
    uk: 'Підключено',
  },
  disconnectBot: {
    pl: 'Odłącz bota',
    ru: 'Отключить бота',
    en: 'Disconnect bot',
    uk: 'Відключити бота',
  },
  connectBot: {
    pl: 'Podłącz',
    ru: 'Подключить',
    en: 'Connect',
    uk: 'Підключити',
  },

  // ─── Telegram Bot Menu ────────────────────────────────────────────────────
  tgMenuTitle: {
    pl: 'Konfiguracja menu bota Telegram',
    ru: 'Настройка меню Telegram бота',
    en: 'Telegram Bot Menu Setup',
    uk: 'Налаштування меню Telegram бота',
  },
  tgMenuSubtitle: {
    pl: 'Wiadomość powitalna, przyciski i polecenia widoczne przez użytkowników',
    ru: 'Приветственное сообщение, кнопки и команды, которые видят пользователи',
    en: 'Welcome message, buttons and commands visible to users',
    uk: 'Привітальне повідомлення, кнопки та команди, які бачать користувачі',
  },
  tgTest: {
    pl: 'Test',
    ru: 'Тест',
    en: 'Test',
    uk: 'Тест',
  },
  tgSave: {
    pl: 'Zapisz',
    ru: 'Сохранить',
    en: 'Save',
    uk: 'Зберегти',
  },
  tgConstructor: {
    pl: 'Kreator',
    ru: 'Конструктор',
    en: 'Constructor',
    uk: 'Конструктор',
  },
  tgWelcomeMessage: {
    pl: 'Wiadomość powitalna',
    ru: 'Приветственное сообщение',
    en: 'Welcome Message',
    uk: 'Привітальне повідомлення',
  },
  tgWelcomeMessageDesc: {
    pl: 'Wyświetlana za każdym razem, gdy użytkownik pisze do bota',
    ru: 'Отображается каждый раз, когда пользователь пишет боту',
    en: 'Displayed every time a user writes to the bot',
    uk: 'Відображається кожного разу, коли користувач пише боту',
  },
  tgMenuButtons: {
    pl: 'Przyciski menu',
    ru: 'Кнопки меню',
    en: 'Menu Buttons',
    uk: 'Кнопки меню',
  },
  tgMenuButtonsDesc: {
    pl: 'Przyciski wyświetlane pod wiadomością bota',
    ru: 'Кнопки отображаются под сообщением бота',
    en: 'Buttons displayed below the bot message',
    uk: 'Кнопки відображаються під повідомленням бота',
  },
  tgAdd: {
    pl: 'Dodaj',
    ru: 'Добавить',
    en: 'Add',
    uk: 'Додати',
  },
  tgNoButtons: {
    pl: 'Brak przycisków. Kliknij «Dodaj».',
    ru: 'Кастомных кнопок нет. Нажмите «Добавить».',
    en: 'No custom buttons. Click «Add».',
    uk: 'Кастомних кнопок немає. Натисніть «Додати».',
  },
  tgNoName: {
    pl: 'Bez nazwy',
    ru: 'Без названия',
    en: 'No name',
    uk: 'Без назви',
  },
  tgNewRowOn: {
    pl: 'Zawsze od nowej linii (kliknij aby anulować)',
    ru: 'Всегда с новой строки (нажмите чтобы отменить)',
    en: 'Always on new line (click to cancel)',
    uk: 'Завжди з нового рядка (натисніть щоб скасувати)',
  },
  tgNewRowBtn: {
    pl: 'Dodaj nową linię przed przyciskiem',
    ru: 'Добавить перенос строки перед кнопкой',
    en: 'Add new line before button',
    uk: 'Додати перенос рядка перед кнопкою',
  },
  tgNewRowTemplate: {
    pl: 'Dodaj nową linię przed szablonem',
    ru: 'Добавить перенос строки перед шаблоном',
    en: 'Add new line before template',
    uk: 'Додати перенос рядка перед шаблоном',
  },
  tgBtnText: {
    pl: 'Tekst przycisku (z emoji)',
    ru: 'Текст кнопки (с эмодзи)',
    en: 'Button text (with emoji)',
    uk: 'Текст кнопки (з емодзі)',
  },
  tgAddRangeHint: {
    pl: 'Kliknij «+ Zakres» aby wybrać kolumny i wiersze',
    ru: 'Нажмите «+ Диапазон» чтобы выбрать столбцы и строки',
    en: 'Click «+ Range» to select columns and rows',
    uk: 'Натисніть «+ Діапазон» щоб вибрати стовпці та рядки',
  },
  tgRange: {
    pl: 'Zakres',
    ru: 'Диапазон',
    en: 'Range',
    uk: 'Діапазон',
  },
  tgSheet: {
    pl: 'ARKUSZ',
    ru: 'ЛИСТ',
    en: 'SHEET',
    uk: 'АРКУШ',
  },
  tgColumns: {
    pl: 'KOLUMNY',
    ru: 'СТОЛБЦЫ',
    en: 'COLUMNS',
    uk: 'СТОВПЦІ',
  },
  tgRows: {
    pl: 'WIERSZE',
    ru: 'СТРОКИ',
    en: 'ROWS',
    uk: 'РЯДКИ',
  },
  tgAddRange: {
    pl: '+ Zakres',
    ru: '+ Диапазон',
    en: '+ Range',
    uk: '+ Діапазон',
  },
  tgSheetReadHint: {
    pl: 'Po kliknięciu bot przeczyta wszystkie zakresy i wyśle dane. Tabela z ustawień profilu.',
    ru: 'При нажатии бот прочитает все диапазоны и пришлёт данные. Таблица из настроек профиля.',
    en: 'On click, the bot reads all ranges and sends the data. Spreadsheet from profile settings.',
    uk: 'При натисканні бот прочитає всі діапазони та надішле дані. Таблиця з налаштувань профілю.',
  },
  tgBotCommands: {
    pl: 'Polecenia bota',
    ru: 'Команды бота',
    en: 'Bot Commands',
    uk: 'Команди бота',
  },
  tgBotCommandsDesc: {
    pl: '/polecenia w lewym dolnym menu Telegrama',
    ru: '/команды в левом нижнем меню Telegram',
    en: '/commands in Telegram left bottom menu',
    uk: '/команди в лівому нижньому меню Telegram',
  },
  tgDeployCommands: {
    pl: 'Załaduj do bota',
    ru: 'Загрузить в бота',
    en: 'Deploy to Bot',
    uk: 'Завантажити в бота',
  },
  tgNoCommands: {
    pl: 'Brak poleceń. Kliknij «Dodaj».',
    ru: 'Команд нет. Нажмите «Добавить».',
    en: 'No commands. Click «Add».',
    uk: 'Команд немає. Натисніть «Додати».',
  },
  tgCommandDesc: {
    pl: 'Opis polecenia',
    ru: 'Описание команды',
    en: 'Command description',
    uk: 'Опис команди',
  },
  tgCommandsHint: {
    pl: 'Po edycji kliknij «Załaduj do bota», aby zastosować polecenia w Telegramie.',
    ru: 'После редактирования нажмите «Загрузить в бота» для применения команд в Telegram.',
    en: 'After editing, click «Deploy to Bot» to apply commands in Telegram.',
    uk: 'Після редагування натисніть «Завантажити в бота» для застосування команд у Telegram.',
  },
  tgTemplates: {
    pl: 'Szablony z przyciskami kopiowania',
    ru: 'Шаблоны с кнопками копирования',
    en: 'Templates with Copy Buttons',
    uk: 'Шаблони з кнопками копіювання',
  },
  tgTemplatesDesc: {
    pl: 'Bloki tekstowe (dane, konta) z przyciskami «Kopiuj»',
    ru: 'Текстовые блоки (реквизиты, данные) с кнопками «Скопировать»',
    en: 'Text blocks (details, data) with «Copy» buttons',
    uk: 'Текстові блоки (реквізити, дані) з кнопками «Скопіювати»',
  },
  tgNoTemplates: {
    pl: 'Brak szablonów. Kliknij «Dodaj».',
    ru: 'Шаблонов нет. Нажмите «Добавить».',
    en: 'No templates. Click «Add».',
    uk: 'Шаблонів немає. Натисніть «Додати».',
  },
  tgTemplateExample: {
    pl: 'Przykład: dane bankowe, IBAN, telefon — z przyciskami kopiowania',
    ru: 'Пример: реквизиты банка, IBAN, телефон — с кнопками копирования',
    en: 'Example: bank details, IBAN, phone — with copy buttons',
    uk: 'Приклад: реквізити банку, IBAN, телефон — з кнопками копіювання',
  },
  tgTemplateName: {
    pl: 'Nazwa (dla administratora)',
    ru: 'Название (для администратора)',
    en: 'Name (for admin)',
    uk: 'Назва (для адміністратора)',
  },
  tgTemplateTrigger: {
    pl: 'Wyzwalacz',
    ru: 'Триггер',
    en: 'Trigger',
    uk: 'Тригер',
  },
  tgTemplateContent: {
    pl: 'Treść wiadomości',
    ru: 'Содержимое сообщения',
    en: 'Message content',
    uk: 'Вміст повідомлення',
  },
  tgAddText: {
    pl: 'Tekst',
    ru: 'Текст',
    en: 'Text',
    uk: 'Текст',
  },
  tgAddButton: {
    pl: 'Przycisk',
    ru: 'Кнопка',
    en: 'Button',
    uk: 'Кнопка',
  },
  tgNoBlocks: {
    pl: 'Kliknij «Tekst» lub «Przycisk», aby dodać blok',
    ru: 'Нажмите «Текст» или «Кнопка» чтобы добавить блок',
    en: 'Click «Text» or «Button» to add a block',
    uk: 'Натисніть «Текст» або «Кнопка» щоб додати блок',
  },
  tgDragHint: {
    pl: 'Przeciągnij, aby zmienić kolejność',
    ru: 'Перетащить для изменения порядка',
    en: 'Drag to reorder',
    uk: 'Перетягнути для зміни порядку',
  },
  tgZapHint: {
    pl: 'Dodaj w «Przyciski menu» przycisk z typem «Akcja bota» i callback_data = wyzwalaczowi szablonu.',
    ru: 'Добавьте в «Кнопки меню» кнопку с типом «Действие бота» и callback_data = триггеру шаблона.',
    en: 'Add to «Menu Buttons» a button with type «Bot Action» and callback_data matching the template trigger.',
    uk: 'Додайте в «Кнопки меню» кнопку з типом «Дія бота» і callback_data = тригеру шаблону.',
  },
  tgLayoutEditor: {
    pl: 'Edytor układu',
    ru: 'Редактор расположения',
    en: 'Layout Editor',
    uk: 'Редактор розташування',
  },
  tgLayoutEditorDesc: {
    pl: 'Przeciągaj przyciski bezpośrednio w oknie bota',
    ru: 'Перетаскивайте кнопки прямо в окне бота',
    en: 'Drag buttons directly in the bot window',
    uk: 'Перетягуйте кнопки прямо у вікні бота',
  },
  tgPreviewOnly: {
    pl: 'Tylko podgląd.',
    ru: 'Только предпросмотр.',
    en: 'Preview only.',
    uk: 'Тільки попередній перегляд.',
  },
  tgPreviewNote: {
    pl: 'Kolor i rozmiar przycisków nie są przekazywane do Telegrama — wygląd zależy od motywu aplikacji użytkownika. Działa tylko «Przyciski w rzędzie».',
    ru: 'Цвет и размер кнопок не передаются в Telegram — внешний вид определяется темой приложения у пользователя. Работает только «Кнопок в ряд».',
    en: 'Button color and size are not sent to Telegram — appearance depends on the user\'s app theme. Only «Buttons per row» works.',
    uk: 'Колір і розмір кнопок не передаються в Telegram — вигляд визначається темою додатка. Працює тільки «Кнопок у ряд».',
  },
  tgButtonsPerRow: {
    pl: 'Przycisków w rzędzie',
    ru: 'Кнопок в ряд',
    en: 'Buttons per row',
    uk: 'Кнопок у ряд',
  },
  tgButtonSize: {
    pl: 'Rozmiar przycisku',
    ru: 'Размер кнопки',
    en: 'Button size',
    uk: 'Розмір кнопки',
  },
  tgButtonColor: {
    pl: 'Kolor przycisków',
    ru: 'Цвет кнопок',
    en: 'Button color',
    uk: 'Колір кнопок',
  },
  tgCustomColor: {
    pl: 'Własny kolor',
    ru: 'Свой цвет',
    en: 'Custom color',
    uk: 'Свій колір',
  },
  tgOnline: {
    pl: 'online',
    ru: 'в сети',
    en: 'online',
    uk: 'онлайн',
  },
  tgLayout: {
    pl: 'MAKIET',
    ru: 'МАКЕТ',
    en: 'LAYOUT',
    uk: 'МАКЕТ',
  },
  tgTypeMessage: {
    pl: 'Napisz wiadomość...',
    ru: 'Написать сообщение...',
    en: 'Write a message...',
    uk: 'Написати повідомлення...',
  },
  tgNoButtonsAdded: {
    pl: 'Brak przycisków',
    ru: 'Кнопки не добавлены',
    en: 'No buttons added',
    uk: 'Кнопки не додані',
  },
  tgConnectedBots: {
    pl: 'Podłączone boty',
    ru: 'Подключённые боты',
    en: 'Connected Bots',
    uk: 'Підключені боти',
  },
  tgNoActiveBots: {
    pl: 'Brak aktywnych botów',
    ru: 'Нет активных ботов',
    en: 'No active bots',
    uk: 'Немає активних ботів',
  },
  tgConnectBotHint: {
    pl: 'Podłącz bota w sekcji «Ustawienia»',
    ru: 'Подключите бота в разделе «Настройки»',
    en: 'Connect a bot in the «Settings» section',
    uk: 'Підключіть бота в розділі «Налаштування»',
  },
  tgSendTestMessage: {
    pl: 'Wyślij wiadomość testową',
    ru: 'Отправить тестовое сообщение',
    en: 'Send test message',
    uk: 'Надіслати тестове повідомлення',
  },
  tgBotLanguage: {
    pl: 'Język bota',
    ru: 'Язык бота',
    en: 'Bot language',
    uk: 'Мова бота',
  },
  tgBotLanguageDesc: {
    pl: 'Język wiadomości systemowych wysyłanych przez bota użytkownikom',
    ru: 'Язык системных сообщений, которые бот отправляет пользователям',
    en: 'Language of system messages sent by the bot to users',
    uk: 'Мова системних повідомлень, які бот надсилає користувачам',
  },
  tgBotLanguageLabel: {
    pl: 'Język interfejsu bota',
    ru: 'Язык интерфейса бота',
    en: 'Bot interface language',
    uk: 'Мова інтерфейсу бота',
  },
  tgBotLanguageHint: {
    pl: 'Wpływa na podpowiedzi systemowe i komunikaty o błędach. Własne teksty przycisków i szablonów nie zostaną zmienione.',
    ru: 'Влияет на системные подсказки и сообщения об ошибках. Ваши собственные тексты кнопок и шаблонов не изменяются.',
    en: 'Affects system hints and error messages. Your own button and template texts are not changed.',
    uk: 'Впливає на системні підказки та повідомлення про помилки. Ваші власні тексти кнопок і шаблонів не змінюються.',
  },
  tgAdvancedSettings: {
    pl: 'Zaawansowane ustawienia',
    ru: 'Расширенные настройки',
    en: 'Advanced Settings',
    uk: 'Розширені налаштування',
  },
  tgAdvancedSettingsDesc: {
    pl: 'Dodatkowe parametry zachowania bota',
    ru: 'Дополнительные параметры поведения бота',
    en: 'Additional bot behavior parameters',
    uk: 'Додаткові параметри поведінки бота',
  },
  tgDeleteOldMessages: {
    pl: 'Usuwaj stare wiadomości',
    ru: 'Удалять старые сообщения',
    en: 'Delete old messages',
    uk: 'Видаляти старі повідомлення',
  },
  tgDeleteOldMessagesHint: {
    pl: 'Bot będzie usuwał poprzednie menu przy każdej aktualizacji, aby nie zaśmiecać czatu',
    ru: 'Бот будет удалять предыдущее меню при каждом обновлении, чтобы не засорять чат',
    en: 'The bot will delete the previous menu on each update to keep the chat clean',
    uk: 'Бот видалятиме попереднє меню при кожному оновленні, щоб не засмічувати чат',
  },
  tgSilentMessages: {
    pl: 'Ciche wiadomości',
    ru: 'Беззвучные сообщения',
    en: 'Silent messages',
    uk: 'Беззвучні повідомлення',
  },
  tgSilentMessagesHint: {
    pl: 'Wiadomości bota nie będą powodować dźwięku powiadomienia u użytkowników',
    ru: 'Сообщения бота не будут вызывать звук уведомления у пользователей',
    en: 'Bot messages will not trigger notification sounds for users',
    uk: 'Повідомлення бота не викликатимуть звук сповіщення у користувачів',
  },
  tgSessionTimeout: {
    pl: 'Limit czasu sesji (godz.)',
    ru: 'Тайм-аут сессии (часы)',
    en: 'Session timeout (hours)',
    uk: 'Тайм-аут сесії (години)',
  },
  tgNoLimit: {
    pl: 'Bez limitu',
    ru: 'Без ограничений',
    en: 'No limit',
    uk: 'Без обмежень',
  },
  tgSessionTimeoutHint: {
    pl: 'Po upływie limitu użytkownik ponownie otrzyma wiadomość powitalną. 0 = bez limitu.',
    ru: 'После истечения тайм-аута пользователь получит приветственное сообщение заново. 0 = без ограничений.',
    en: 'After timeout, the user will receive the welcome message again. 0 = no limit.',
    uk: 'Після закінчення тайм-ауту користувач отримає привітальне повідомлення знову. 0 = без обмежень.',
  },
  tgConnectedBotsDesc: {
    pl: 'Aktywne boty Telegram powiązane z Twoim kontem',
    ru: 'Активные Telegram-боты, привязанные к вашему аккаунту',
    en: 'Active Telegram bots linked to your account',
    uk: 'Активні Telegram-боти, прив\'язані до вашого облікового запису',
  },
  tgConnectBotAppHint: {
    pl: 'Podłącz bota w sekcji «Ustawienia» aplikacji',
    ru: 'Подключите бота в разделе «Настройки» приложения',
    en: 'Connect a bot in «Settings» section of the app',
    uk: 'Підключіть бота в розділі «Налаштування» додатку',
  },
  tgSaveSettings: {
    pl: 'Zapisz ustawienia',
    ru: 'Сохранить настройки',
    en: 'Save settings',
    uk: 'Зберегти налаштування',
  },
  tgColNamePlaceholder: {
    pl: 'Nazwa...',
    ru: 'Название...',
    en: 'Name...',
    uk: 'Назва...',
  },
  tgTemplateNamePlaceholder: {
    pl: 'Dane bankowe',
    ru: 'Реквизиты банка',
    en: 'Bank details',
    uk: 'Реквізити банку',
  },
  tgBotLangAuto: {
    pl: '🤖 Auto (język Telegram)',
    ru: '🤖 Авто (язык Telegram)',
    en: '🤖 Auto (Telegram language)',
    uk: '🤖 Авто (мова Telegram)',
  },
  tgBotLangAutoHint: {
    pl: 'Język dobierany automatycznie według ustawień Telegram użytkownika (ru, uk, en, pl). Przy nieznanym języku używany jest angielski.',
    ru: 'Язык подбирается по настройке Telegram у пользователя (ru, uk, en, pl). При неизвестном языке — английский.',
    en: "Language is automatically picked from the user's Telegram language setting (ru, uk, en, pl). Falls back to English for unknown languages.",
    uk: 'Мова підбирається за налаштуванням Telegram користувача (ru, uk, en, pl). При невідомій мові — англійська.',
  },
  tgSessionExpires: {
    pl: 'Sesja wygaśnie za {h} godz.',
    ru: 'Сессия истекает через {h} ч',
    en: 'Session expires in {h} h',
    uk: 'Сесія закінчується через {h} год',
  },
  tgSharedBot: {
    pl: 'Bot wspólny',
    ru: 'Общий бот',
    en: 'Shared bot',
    uk: 'Спільний бот',
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
