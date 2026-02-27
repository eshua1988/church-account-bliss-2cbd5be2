import { useState, useRef, useEffect } from 'react';
import { openPdfUrl } from '@/lib/pdfDownload';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Eraser, Save, Loader2, CheckCircle, ImagePlus, X, Globe, ArrowLeft, ArrowRight, Send } from 'lucide-react';
import currencyConvertIcon from '@/assets/currency-convert-icon.png';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';
import { CurrencyConverter } from '@/components/CurrencyConverter';

type Language = 'pl' | 'ru' | 'en' | 'uk';
type LinkType = 'standard' | 'stepwise';

const LANGUAGE_NAMES: Record<Language, string> = {
  pl: 'Polski',
  ru: 'Русский',
  en: 'English',
  uk: 'Українська',
};

const languageFlags: Record<Language, string> = {
  pl: '🇵🇱',
  ru: '🇷🇺',
  en: '🇬🇧',
  uk: '🇺🇦',
};

// Translations for all UI text
const translations: Record<Language, Record<string, string>> = {
  pl: {
    title: 'Dowód wypłaty',
    subtitle: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    requiredFields: '* Pola obowiązkowe do wypełnienia',
    date: 'Data',
    amount: 'Suma',
    issuedTo: 'Wydano (imię i nazwisko)',
    bankAccount: 'Konto do przelewu',
    bankAccountPlaceholder: 'Wpisz numer konta lub telefonu...',
    department: 'Nazwa oddziału',
    selectCategory: 'Wybierz kategorię',
    basis: 'Podstawa (na jakie potrzeby)',
    basisPlaceholder: 'Wpisz podstawę wypłaty...',
    amountInWords: 'Suma słownie',
    attachments: 'Załączniki (zdjęcia)',
    required: 'Obowiązkowe',
    optional: 'Nieobowiązkowe',
    addPhotos: 'Dodaj zdjęcia',
    photoNote: 'Każde zdjęcie zostanie umieszczone na osobnej stronie PDF',
    signature: 'Podpis odbiorcy',
    clear: 'Wyczyść',
    saveAndDownload: 'Wyślij',
    saving: 'Wysyłanie...',
    success: 'Wysłano!',
    successMessage: 'Dokument został zapisany. Możesz zamknąć tę stronę.',
    createAnother: 'Utwórz kolejny dokument',
    loading: 'Ładowanie...',
    invalidLink: 'Nieprawidłowy link',
    linkInactive: 'Link jest nieaktywny lub nie istnieje',
    cannotLoad: 'Nie można załadować danych',
    enterData: 'Wprowadź swoje dane',
    enterDataDesc: 'Aby kontynuować, podaj imię i nazwisko',
    firstName: 'Imię',
    lastName: 'Nazwisko',
    continue: 'Kontynuuj',
    checking: 'Sprawdzanie...',
    foundDocuments: 'Znaleźliśmy dokumenty bez zdjęć',
    selectDocument: 'Wybierz dokument, aby dodać zdjęcia, lub utwórz nowy',
    createNew: 'Utwórz nowy dokument',
    noDescription: 'Bez opisu',
    addPhotosTitle: 'Dodaj zdjęcia do dokumentu',
    documentData: 'Dane dokumentu:',
    recipient: 'Odbiorca:',
    basisLabel: 'Podstawa:',
    photosAdded: 'Zdjęcia zostały dodane do dokumentu',
    enterFirstName: 'Wpisz imię...',
    enterLastName: 'Wpisz nazwisko...',
    enterName: 'Wpisz imię i nazwisko...',
    back: 'Wstecz',
    next: 'Dalej',
    step: 'Krok',
    stepBasicInfo: 'Podstawowe dane',
    stepCategory: 'Kategoria i opis',
    stepPhotos: 'Zdjęcia',
    stepSignature: 'Podpis',
    stepReview: 'Podsumowanie',
    downloadPdf: 'Wyślij',
    reviewTitle: 'Sprawdź dane przed wysłaniem',
  },
  ru: {
    title: 'Расходный ордер',
    subtitle: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    requiredFields: '* Обязательные поля для заполнения',
    date: 'Дата',
    amount: 'Сумма',
    issuedTo: 'Выдано (имя и фамилия)',
    bankAccount: 'Счёт для перевода',
    bankAccountPlaceholder: 'Введите номер счёта или телефон...',
    department: 'Название отдела',
    selectCategory: 'Выберите категорию',
    basis: 'Основание (на какие нужды)',
    basisPlaceholder: 'Введите основание выплаты...',
    amountInWords: 'Сумма прописью',
    attachments: 'Вложения (фото)',
    required: 'Обязательно',
    optional: 'Необязательно',
    addPhotos: 'Добавить фото',
    photoNote: 'Каждое фото будет размещено на отдельной странице PDF',
    signature: 'Подпись получателя',
    clear: 'Очистить',
    saveAndDownload: 'Отправить',
    saving: 'Отправка...',
    success: 'Отправлено!',
    successMessage: 'Документ сохранён. Можете закрыть эту страницу.',
    createAnother: 'Создать ещё один документ',
    loading: 'Загрузка...',
    invalidLink: 'Неверная ссылка',
    linkInactive: 'Ссылка неактивна или не существует',
    cannotLoad: 'Не удалось загрузить данные',
    enterData: 'Введите свои данные',
    enterDataDesc: 'Чтобы продолжить, укажите имя и фамилию',
    firstName: 'Имя',
    lastName: 'Фамилия',
    continue: 'Продолжить',
    checking: 'Проверка...',
    foundDocuments: 'Найдены документы без фото',
    selectDocument: 'Выберите документ для добавления фото или создайте новый',
    createNew: 'Создать новый документ',
    noDescription: 'Без описания',
    addPhotosTitle: 'Добавить фото к документу',
    documentData: 'Данные документа:',
    recipient: 'Получатель:',
    basisLabel: 'Основание:',
    photosAdded: 'Фото добавлены к документу',
    enterFirstName: 'Введите имя...',
    enterLastName: 'Введите фамилию...',
    enterName: 'Введите имя и фамилию...',
    back: 'Назад',
    next: 'Далее',
    step: 'Шаг',
    stepBasicInfo: 'Основные данные',
    stepCategory: 'Категория и описание',
    stepPhotos: 'Фото и вложения',
    stepSignature: 'Подпись',
    stepReview: 'Итоги',
    downloadPdf: 'Скачать PDF',
    reviewTitle: 'Проверьте данные перед отправкой',
  },
  en: {
    title: 'Payment Voucher',
    subtitle: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    requiredFields: '* Required fields',
    date: 'Date',
    amount: 'Amount',
    issuedTo: 'Issued to (full name)',
    bankAccount: 'Bank account',
    bankAccountPlaceholder: 'Enter account number or phone...',
    department: 'Department name',
    selectCategory: 'Select category',
    basis: 'Purpose (for what needs)',
    basisPlaceholder: 'Enter payment purpose...',
    amountInWords: 'Amount in words',
    attachments: 'Attachments (photos)',
    required: 'Required',
    optional: 'Optional',
    addPhotos: 'Add photos',
    photoNote: 'Each photo will be placed on a separate PDF page',
    signature: 'Recipient signature',
    clear: 'Clear',
    saveAndDownload: 'Send',
    saving: 'Sending...',
    success: 'Sent!',
    successMessage: 'Document sent. You can close this page.',
    createAnother: 'Create another document',
    loading: 'Loading...',
    invalidLink: 'Invalid link',
    linkInactive: 'Link is inactive or does not exist',
    cannotLoad: 'Failed to load data',
    enterData: 'Enter your details',
    enterDataDesc: 'To continue, enter your first and last name',
    firstName: 'First name',
    lastName: 'Last name',
    continue: 'Continue',
    checking: 'Checking...',
    foundDocuments: 'Found documents without photos',
    selectDocument: 'Select a document to add photos, or create new',
    createNew: 'Create new document',
    noDescription: 'No description',
    addPhotosTitle: 'Add photos to document',
    documentData: 'Document data:',
    recipient: 'Recipient:',
    basisLabel: 'Purpose:',
    photosAdded: 'Photos added to document',
    enterFirstName: 'Enter first name...',
    enterLastName: 'Enter last name...',
    enterName: 'Enter full name...',
    back: 'Back',
    next: 'Next',
    step: 'Step',
    stepBasicInfo: 'Basic info',
    stepCategory: 'Category & description',
    stepPhotos: 'Photos',
    stepSignature: 'Signature',
    stepReview: 'Review',
    downloadPdf: 'Download PDF',
    reviewTitle: 'Review before sending',
  },
  uk: {
    title: 'Видатковий ордер',
    subtitle: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    requiredFields: '* Обов\'язкові поля для заповнення',
    date: 'Дата',
    amount: 'Сума',
    issuedTo: 'Видано (ім\'я та прізвище)',
    bankAccount: 'Рахунок для переказу',
    bankAccountPlaceholder: 'Введіть номер рахунку або телефон...',
    department: 'Назва відділу',
    selectCategory: 'Виберіть категорію',
    basis: 'Підстава (на які потреби)',
    basisPlaceholder: 'Введіть підставу виплати...',
    amountInWords: 'Сума прописом',
    attachments: 'Вкладення (фото)',
    required: 'Обов\'язково',
    optional: 'Необов\'язково',
    addPhotos: 'Додати фото',
    photoNote: 'Кожне фото буде розміщено на окремій сторінці PDF',
    signature: 'Підпис отримувача',
    clear: 'Очистити',
    saveAndDownload: 'Надіслати',
    saving: 'Надсилання...',
    success: 'Надіслано!',
    successMessage: 'Документ збережено. Можете закрити цю сторінку.',
    createAnother: 'Створити ще один документ',
    loading: 'Завантаження...',
    invalidLink: 'Невірне посилання',
    linkInactive: 'Посилання неактивне або не існує',
    cannotLoad: 'Не вдалося завантажити дані',
    enterData: 'Введіть свої дані',
    enterDataDesc: 'Щоб продовжити, вкажіть ім\'я та прізвище',
    firstName: 'Ім\'я',
    lastName: 'Прізвище',
    continue: 'Продовжити',
    checking: 'Перевірка...',
    foundDocuments: 'Знайдено документи без фото',
    selectDocument: 'Виберіть документ для додавання фото або створіть новий',
    createNew: 'Створити новий документ',
    noDescription: 'Без опису',
    addPhotosTitle: 'Додати фото до документу',
    documentData: 'Дані документу:',
    recipient: 'Отримувач:',
    basisLabel: 'Підстава:',
    photosAdded: 'Фото додано до документу',
    enterFirstName: 'Введіть ім\'я...',
    enterLastName: 'Введіть прізвище...',
    enterName: 'Введіть ім\'я та прізвище...',
    back: 'Назад',
    next: 'Далі',
    step: 'Крок',
    stepBasicInfo: 'Основні дані',
    stepCategory: 'Категорія та опис',
    stepPhotos: 'Фото та вкладення',
    stepSignature: 'Підпис',
    stepReview: 'Підсумок',
    downloadPdf: 'Надіслати',
    reviewTitle: 'Перевірте дані перед відправкою',
  },
};

interface AttachedImage {
  file: File;
  preview: string;
}

interface PayoutFormData {
  date: Date;
  currency: string;
  amount: string;
  issuedTo: string;
  bankAccount: string;
  departmentName: string;
  basis: string;
  amountInWords: string;
}

interface Category {
  id: string;
  name: string;
  type: string;
}

interface SharedLink {
  id: string;
  owner_user_id: string;
  token: string;
  name: string | null;
  is_active: boolean;
}

// Helper function to load font as base64
const loadFontAsBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Number to words conversion
const numberToWords = (num: number, currency: string, lang: string = 'pl'): string => {
  if (isNaN(num) || num === 0) return '';
  
  const currencyNames: Record<string, Record<string, { singular: string; plural: string; genitive: string }>> = {
    PLN: {
      pl: { singular: 'złoty', plural: 'złotych', genitive: 'złote' },
      ru: { singular: 'злотый', plural: 'злотых', genitive: 'злотых' },
      uk: { singular: 'злотий', plural: 'злотих', genitive: 'злотих' },
      en: { singular: 'zloty', plural: 'zlotys', genitive: 'zlotys' },
    },
    EUR: {
      pl: { singular: 'euro', plural: 'euro', genitive: 'euro' },
      ru: { singular: 'евро', plural: 'евро', genitive: 'евро' },
      uk: { singular: 'євро', plural: 'євро', genitive: 'євро' },
      en: { singular: 'euro', plural: 'euros', genitive: 'euros' },
    },
    USD: {
      pl: { singular: 'dolar', plural: 'dolarów', genitive: 'dolary' },
      ru: { singular: 'доллар', plural: 'долларов', genitive: 'доллара' },
      uk: { singular: 'долар', plural: 'доларів', genitive: 'долари' },
      en: { singular: 'dollar', plural: 'dollars', genitive: 'dollars' },
    },
    UAH: {
      pl: { singular: 'hrywna', plural: 'hrywien', genitive: 'hrywny' },
      ru: { singular: 'гривна', plural: 'гривен', genitive: 'гривны' },
      uk: { singular: 'гривня', plural: 'гривень', genitive: 'гривні' },
      en: { singular: 'hryvnia', plural: 'hryvnias', genitive: 'hryvnias' },
    },
    RUB: {
      pl: { singular: 'rubel', plural: 'rubli', genitive: 'ruble' },
      ru: { singular: 'рубль', plural: 'рублей', genitive: 'рубля' },
      uk: { singular: 'рубль', plural: 'рублів', genitive: 'рублі' },
      en: { singular: 'ruble', plural: 'rubles', genitive: 'rubles' },
    },
    BYN: {
      pl: { singular: 'rubel białoruski', plural: 'rubli białoruskich', genitive: 'ruble białoruskie' },
      ru: { singular: 'белорусский рубль', plural: 'белорусских рублей', genitive: 'белорусских рубля' },
      uk: { singular: 'білоруський рубль', plural: 'білоруських рублів', genitive: 'білоруських рублі' },
      en: { singular: 'Belarusian ruble', plural: 'Belarusian rubles', genitive: 'Belarusian rubles' },
    },
  };

  const ones: Record<string, string[]> = {
    pl: ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'],
    ru: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'],
    uk: ['', 'один', 'два', 'три', 'чотири', 'п\'ять', 'шість', 'сім', 'вісім', 'дев\'ять', 'десять', 'одинадцять', 'дванадцять', 'тринадцять', 'чотирнадцять', 'п\'ятнадцять', 'шістнадцять', 'сімнадцять', 'вісімнадцять', 'дев\'ятнадцять'],
    en: ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'],
  };

  const tens: Record<string, string[]> = {
    pl: ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'],
    ru: ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'],
    uk: ['', '', 'двадцять', 'тридцять', 'сорок', 'п\'ятдесят', 'шістдесят', 'сімдесят', 'вісімдесят', 'дев\'яносто'],
    en: ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'],
  };

  const hundreds: Record<string, string[]> = {
    pl: ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'],
    ru: ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'],
    uk: ['', 'сто', 'двісті', 'триста', 'чотириста', 'п\'ятсот', 'шістсот', 'сімсот', 'вісімсот', 'дев\'ятсот'],
    en: ['', 'one hundred', 'two hundred', 'three hundred', 'four hundred', 'five hundred', 'six hundred', 'seven hundred', 'eight hundred', 'nine hundred'],
  };

  const thousands: Record<string, { singular: string; plural: string; genitive: string }> = {
    pl: { singular: 'tysiąc', plural: 'tysięcy', genitive: 'tysiące' },
    ru: { singular: 'тысяча', plural: 'тысяч', genitive: 'тысячи' },
    uk: { singular: 'тисяча', plural: 'тисяч', genitive: 'тисячі' },
    en: { singular: 'thousand', plural: 'thousand', genitive: 'thousand' },
  };

  const l = lang in ones ? lang : 'pl';
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);
  
  const convertHundreds = (n: number): string => {
    if (n === 0) return '';
    if (n < 20) return ones[l][n];
    if (n < 100) {
      const t = Math.floor(n / 10);
      const o = n % 10;
      return tens[l][t] + (o > 0 ? ' ' + ones[l][o] : '');
    }
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return hundreds[l][h] + (rest > 0 ? ' ' + convertHundreds(rest) : '');
  };

  const getThousandWord = (n: number): string => {
    const lastTwo = n % 100;
    const lastOne = n % 10;
    if (lastTwo >= 11 && lastTwo <= 19) return thousands[l].plural;
    if (lastOne === 1) return thousands[l].singular;
    if (lastOne >= 2 && lastOne <= 4) return thousands[l].genitive;
    return thousands[l].plural;
  };

  const getCurrencyWord = (n: number): string => {
    const lastTwo = n % 100;
    const lastOne = n % 10;
    const curr = currencyNames[currency]?.[l] || currencyNames['PLN'][l];
    if (lastTwo >= 11 && lastTwo <= 19) return curr.plural;
    if (lastOne === 1) return curr.singular;
    if (lastOne >= 2 && lastOne <= 4) return curr.genitive;
    return curr.plural;
  };

  let result = '';
  const th = Math.floor(intPart / 1000);
  const rest = intPart % 1000;

  if (th > 0) {
    result += convertHundreds(th) + ' ' + getThousandWord(th) + ' ';
  }
  if (rest > 0 || th === 0) {
    result += convertHundreds(rest);
  }

  result = result.trim() + ' ' + getCurrencyWord(intPart);

  if (decPart > 0) {
    // Fractional unit names per currency and language
    const fractionalWords: Record<string, Record<string, string>> = {
      PLN: { pl: 'groszy', ru: 'грошей', uk: 'грошів', en: 'groszy' },
      EUR: { pl: 'centów', ru: 'центов', uk: 'центів', en: 'cents' },
      USD: { pl: 'centów', ru: 'центов', uk: 'центів', en: 'cents' },
      UAH: { pl: 'kopiejek', ru: 'копеек', uk: 'копійок', en: 'kopiyok' },
      RUB: { pl: 'kopiejek', ru: 'копеек', uk: 'копійок', en: 'kopecks' },
      BYN: { pl: 'kopiejek', ru: 'копеек', uk: 'копійок', en: 'kopecks' },
    };
    const fractUnit = fractionalWords[currency]?.[l] || fractionalWords['PLN'][l];
    const decWords = convertHundreds(decPart);
    result += ` ${decWords} ${fractUnit}`;
  }

  return result.charAt(0).toUpperCase() + result.slice(1);
};

const PublicPayout = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [sharedLink, setSharedLink] = useState<SharedLink | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [fontBase64, setFontBase64] = useState<string | null>(null);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [submitterFirstName, setSubmitterFirstName] = useState('');
  const [submitterLastName, setSubmitterLastName] = useState('');
  const [isCheckingPending, setIsCheckingPending] = useState(false);
  
  // Pending payouts state
  interface PendingPayout {
    id: string;
    amount: number;
    currency: string;
    description: string | null;
    date: string;
    issued_to: string | null;
    amount_in_words: string | null;
    category_id: string | null;
    created_at: string;
  }
  const [pendingPayouts, setPendingPayouts] = useState<PendingPayout[]>([]);
  const [showPendingSelection, setShowPendingSelection] = useState(false);
  const [continuingPayout, setContinuingPayout] = useState<PendingPayout | null>(null);
  const [isAddingImages, setIsAddingImages] = useState(false);
  
  // Navigation history: tracks where user came from for proper back navigation
  type NavigationScreen = 'login' | 'pending' | 'form' | 'continuing';
  const [navigationHistory, setNavigationHistory] = useState<NavigationScreen[]>(['login']);
  
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [language, setLanguage] = useState<Language>('ru');
  const [imagesOptional, setImagesOptional] = useState(false); // false = images required by default
  const [showConverter, setShowConverter] = useState(false);
  
  // Link type and stepwise mode
  const [linkType, setLinkType] = useState<LinkType>('standard');
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 5;
  
  // Translation helper
  const t = translations[language];

  const [formData, setFormData] = useState<PayoutFormData>({
    date: new Date(),
    currency: 'PLN',
    amount: '',
    issuedTo: '',
    bankAccount: '',
    departmentName: '',
    basis: '',
    amountInWords: '',
  });

  const currencies = [
    { value: 'PLN', label: 'zł' },
    { value: 'EUR', label: '€' },
    { value: 'USD', label: '$' },
    { value: 'UAH', label: '₴' },
    { value: 'RUB', label: '₽' },
    { value: 'BYN', label: 'Br' },
  ];

  // Load shared link and categories via secure edge function
  useEffect(() => {
    const loadData = async () => {
      if (!token) {
        setError('Nieprawidłowy link');
        setLoading(false);
        return;
      }

      try {
        // Validate token via secure edge function (doesn't expose tokens or user IDs)
        const { data: validationData, error: validationError } = await supabase.functions.invoke('validate-payout-token', {
          body: { token }
        });

        if (validationError) throw validationError;
        
        if (!validationData?.valid) {
          setError(validationData?.error || 'Link jest nieaktywny lub nie istnieje');
          setLoading(false);
          return;
        }

        // Set link info (token is stored locally, not fetched from DB)
        setSharedLink({
          id: '', // Not needed for submission
          owner_user_id: '', // Not exposed by edge function
          token: token,
          name: validationData.linkName,
          is_active: true,
        });

        // Set link type
        setLinkType((validationData.linkType || 'standard') as LinkType);

        setCategories(validationData.categories || []);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Nie można załadować danych');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token]);

  // Load font
  useEffect(() => {
    const loadFont = async () => {
      try {
        const base64 = await loadFontAsBase64('/fonts/Roboto-Regular.ttf');
        setFontBase64(base64);
        setFontLoaded(true);
      } catch (error) {
        console.error('Failed to load font:', error);
        setFontLoaded(true);
      }
    };
    loadFont();
  }, []);

  // Auto-generate amount in words
  useEffect(() => {
    if (formData.amount) {
      const numAmount = parseFloat(formData.amount);
      if (!isNaN(numAmount) && numAmount > 0) {
        const words = numberToWords(numAmount, formData.currency, language);
        setFormData(prev => ({ ...prev, amountInWords: words }));
      }
    } else {
      setFormData(prev => ({ ...prev, amountInWords: '' }));
    }
  }, [formData.amount, formData.currency, language]);

  const handleInputChange = (field: keyof PayoutFormData, value: string | Date) => {
    if (field === 'amountInWords') return;
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Canvas drawing handlers
  const getCoordinates = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    
    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    // Save signature as data URL when user finishes drawing
    if (signatureCanvasRef.current && hasSignature) {
      setSignatureDataUrl(signatureCanvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    setSignatureDataUrl(null);
  };

  // Image attachment handlers
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: AttachedImage[] = [];
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        const preview = URL.createObjectURL(file);
        newImages.push({ file, preview });
      }
    });

    setAttachedImages(prev => [...prev, ...newImages]);
    
    // Reset input to allow selecting same files again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeImage = (index: number) => {
    setAttachedImages(prev => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].preview);
      newImages.splice(index, 1);
      return newImages;
    });
  };

  // Cleanup previews on unmount
  useEffect(() => {
    return () => {
      attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const generatePDF = async () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    if (fontBase64) {
      doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.setFont('Roboto');
    }
    
    const leftMargin = 20;
    const rightMargin = 20;
    const tableWidth = pageWidth - leftMargin - rightMargin;
    const labelColWidth = 50;
    const valueColWidth = tableWidth - labelColWidth;
    const rowHeight = 10;
    const cellPadding = 3;
    
    // Helper function to draw a cell with borders
    const drawCell = (x: number, y: number, width: number, height: number, text: string, options?: { 
      fill?: boolean, 
      align?: 'left' | 'center' | 'right',
      fontSize?: number 
    }) => {
      const { fill = false, align = 'left', fontSize = 10 } = options || {};
      
      // Draw fill
      if (fill) {
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, width, height, 'F');
      }
      
      // Draw border
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(x, y, width, height, 'S');
      
      // Draw text
      doc.setFontSize(fontSize);
      const textX = align === 'center' ? x + width / 2 : x + cellPadding;
      const textY = y + height / 2 + 3;
      
      // Wrap text if needed
      const maxWidth = width - cellPadding * 2;
      const lines = doc.splitTextToSize(text, maxWidth);
      
      if (align === 'center') {
        doc.text(lines[0] || '', textX, textY, { align: 'center' });
      } else {
        doc.text(lines[0] || '', textX, textY);
      }
    };
    
    // Helper function to draw a row with label and value
    const drawTableRow = (y: number, label: string, value: string, height: number = rowHeight) => {
      drawCell(leftMargin, y, labelColWidth, height, label, { fill: true });
      drawCell(leftMargin + labelColWidth, y, valueColWidth, height, value);
    };
    
    // Header
    doc.setFontSize(11);
    doc.text('ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE', pageWidth / 2, 20, { align: 'center' });
    
    // Title
    doc.setFontSize(16);
    doc.setFont('Roboto', 'normal');
    doc.text('Dowód wypłaty', pageWidth / 2, 32, { align: 'center' });
    
    let yPos = 45;
    
    // Date and Amount row (two small tables side by side)
    const smallTableWidth = (tableWidth - 10) / 2;
    const smallLabelWidth = 35;
    const smallValueWidth = smallTableWidth - smallLabelWidth;
    
    // Date table
    drawCell(leftMargin, yPos, smallLabelWidth, rowHeight, 'Data', { fill: true });
    drawCell(leftMargin + smallLabelWidth, yPos, smallValueWidth, rowHeight, format(formData.date, 'yyyy-MM-dd'));
    
    // Amount table  
    const currencySymbol = currencies.find(c => c.value === formData.currency)?.label || formData.currency;
    const amountTableX = leftMargin + smallTableWidth + 10;
    drawCell(amountTableX, yPos, smallLabelWidth + 10, rowHeight, `Kwota (${formData.currency})`, { fill: true });
    drawCell(amountTableX + smallLabelWidth + 10, yPos, smallValueWidth - 10, rowHeight, `${currencySymbol} ${formData.amount}`);
    
    yPos += rowHeight + 8;
    
    // Main table rows
    drawTableRow(yPos, 'Wydano (imię nazwisko)', formData.issuedTo);
    yPos += rowHeight;
    
    drawTableRow(yPos, 'Konto dla przelewu', formData.bankAccount);
    yPos += rowHeight;
    
    drawTableRow(yPos, 'Nazwa działu', formData.departmentName);
    yPos += rowHeight;
    
    // Basis (multi-line)
    const basisLines = doc.splitTextToSize(formData.basis, valueColWidth - cellPadding * 2);
    const basisHeight = Math.max(rowHeight * 2, basisLines.length * 6 + cellPadding * 2);
    
    drawCell(leftMargin, yPos, labelColWidth, basisHeight, 'Na podstawie', { fill: true });
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, basisHeight, 'S');
    doc.setFontSize(10);
    doc.text(basisLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    yPos += basisHeight;
    
    // Amount in words (multi-line)
    const wordsLines = doc.splitTextToSize(formData.amountInWords, valueColWidth - cellPadding * 2);
    const wordsHeight = Math.max(rowHeight * 2, wordsLines.length * 6 + cellPadding * 2);
    
    drawCell(leftMargin, yPos, labelColWidth, wordsHeight, 'Kwota słownie', { fill: true });
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, wordsHeight, 'S');
    doc.setFontSize(10);
    doc.text(wordsLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    yPos += wordsHeight + 15;
    
    // Cashier line
    doc.setFontSize(10);
    doc.text('Kasjer: ________________________________', leftMargin, yPos);
    doc.text('Podpis kasjera: ________________________________', pageWidth / 2, yPos);
    yPos += 15;
    
    // Recipient signature
    doc.setFontSize(11);
    doc.text('Podpis odbiorcy', leftMargin, yPos);
    yPos += 5;
    
    // Signature box
    const signatureBoxWidth = 150;
    const signatureBoxHeight = 40;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPos, signatureBoxWidth, signatureBoxHeight, 'S');
    
    // Use saved signatureDataUrl (persists even when canvas is unmounted on step 4)
    const sigData = signatureDataUrl || (signatureCanvasRef.current ? signatureCanvasRef.current.toDataURL('image/png') : null);
    if (hasSignature && sigData) {
      doc.addImage(sigData, 'PNG', leftMargin + 5, yPos + 2, signatureBoxWidth - 10, signatureBoxHeight - 4);
    }

    // Add each attached image on a new page
    for (const img of attachedImages) {
      // Add new page for each image
      doc.addPage();
      
      // Read the image file
      const imageData = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(img.file);
      });

      // Get image dimensions to maintain aspect ratio
      const imgElement = await new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = imageData;
      });

      const imgWidth = imgElement.width;
      const imgHeight = imgElement.height;
      
      // Calculate dimensions to fit within page margins with proper padding
      const imgMargin = 15;
      const maxWidth = pageWidth - 2 * imgMargin;
      const maxHeight = pageHeight - 2 * imgMargin;
      
      let finalWidth = maxWidth;
      let finalHeight = (imgHeight / imgWidth) * finalWidth;
      
      if (finalHeight > maxHeight) {
        finalHeight = maxHeight;
        finalWidth = (imgWidth / imgHeight) * finalHeight;
      }
      
      // Center the image on the page
      const xPos = (pageWidth - finalWidth) / 2;
      const imgYPos = (pageHeight - finalHeight) / 2;
      
      const imgFormat = img.file.type.includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(imageData, imgFormat, xPos, imgYPos, finalWidth, finalHeight);
    }
    
    const fileName = `dowod_wyplaty_${format(formData.date, 'yyyy-MM-dd')}_${formData.issuedTo.replace(/\s/g, '_') || 'dokument'}.pdf`;

    // Return blob + base64 WITHOUT downloading yet
    // Download is triggered separately AFTER the transaction is saved
    const pdfBlob = doc.output('blob');
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    return { pdfBase64, fileName, pdfBlob };
  };

  const handleSubmit = async () => {
    if (!token) return;

    setIsSaving(true);

    try {
      // If continuing an existing payout, update it instead of creating new
      if (continuingPayout) {
        const { data: updateData, error: updateError } = await supabase.functions.invoke('add-images-to-payout', {
          body: {
            token,
            transactionId: continuingPayout.id,
            submitterName: `${submitterFirstName} ${submitterLastName}`,
          }
        });

        if (updateError) throw updateError;
        if (updateData?.error) throw new Error(updateData.error);
        
        // Generate PDF with images
        const pdfResult = await generatePDF();

        // Upload PDF directly from client to Storage
        if (pdfResult) {
          try {
            const { data: linkData } = await supabase
              .from('shared_payout_links')
              .select('owner_user_id')
              .eq('token', token)
              .single();

            if (linkData?.owner_user_id) {
              const storagePath = `${linkData.owner_user_id}/${continuingPayout.id}/${pdfResult.fileName}`;
              await supabase.storage
                .from('documents')
                .upload(storagePath, pdfResult.pdfBlob, {
                  contentType: 'application/pdf',
                  upsert: true,
                });
            }
          } catch (e) {
            console.error('PDF upload failed:', e);
          }
        }




        setIsSuccess(true);
        toast({ title: t.success, description: t.photosAdded });
        return;
      }

      // 1. Submit transaction via Edge Function (WITHOUT PDF data)
      const category = categories.find(c => c.name === formData.departmentName);
      const submitterName = `${submitterFirstName} ${submitterLastName}`;

      const { data, error: submitError } = await supabase.functions.invoke('submit-public-payout', {
        body: {
          token,
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          categoryId: category?.id || null,
          description: formData.basis,
          date: format(formData.date, 'yyyy-MM-dd'),
          issuedTo: formData.issuedTo,
          amountInWords: formData.amountInWords,
          submitterName,
          imagesSkipped: imagesOptional,
          departmentName: formData.departmentName,
          // No pdfBase64 here - we upload separately
        }
      });

      if (submitError) throw submitError;
      if (data?.error) throw new Error(data.error);

      const transactionId = data?.transactionId;

      // 2. Generate PDF
      const pdfResult = await generatePDF();

      // 3. Upload PDF + images + signature via Edge Function
      if (pdfResult && transactionId) {
        try {
          // Convert blob to base64
          const arrayBuffer = await pdfResult.pdfBlob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const pdfBase64 = btoa(binary);

          // Convert attached images to base64
          const imagesBase64: { base64: string; mimeType: string; name: string }[] = [];
          for (const img of attachedImages) {
            const buf = await img.file.arrayBuffer();
            const imgBytes = new Uint8Array(buf);
            let imgBin = '';
            for (let i = 0; i < imgBytes.byteLength; i++) imgBin += String.fromCharCode(imgBytes[i]);
            imagesBase64.push({
              base64: btoa(imgBin),
              mimeType: img.file.type || 'image/jpeg',
              name: img.file.name,
            });
          }

          await supabase.functions.invoke('upload-payout-pdf', {
            body: {
              token,
              transactionId,
              pdfBase64,
              fileName: pdfResult.fileName,
              signatureBase64: signatureDataUrl ? signatureDataUrl.split(',')[1] : null,
              images: imagesBase64,
            },
          });
        } catch (e) {
          console.error('PDF upload failed (non-critical):', e);
        }
      }


      setIsSuccess(true);
      toast({ title: t.success, description: t.successMessage });
    } catch (err) {
      console.error('Save error:', err);
      const errorMessage = err instanceof Error ? err.message : t.cannotLoad;
      toast({
        title: 'Błąd',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // For continuing payout, require images
  const isFormValid = continuingPayout 
    ? attachedImages.length > 0 
    : (formData.amount && formData.issuedTo && formData.departmentName && formData.basis && formData.amountInWords && (imagesOptional || attachedImages.length > 0));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <p className="text-destructive text-lg">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Handle create another document - reset to login screen
  const handleCreateAnother = () => {
    // Reset success state
    setIsSuccess(false);
    
    // Reset authentication - go back to login
    setIsAuthenticated(false);
    setSubmitterFirstName('');
    setSubmitterLastName('');
    
    // Reset navigation
    setNavigationHistory(['login']);
    
    // Reset pending payout states
    setContinuingPayout(null);
    setShowPendingSelection(false);
    setPendingPayouts([]);
    
    // Reset stepwise mode
    setCurrentStep(1);
    
    // Reset form data
    setFormData({
      date: new Date(),
      currency: 'PLN',
      amount: '',
      issuedTo: '',
      bankAccount: '',
      departmentName: '',
      basis: '',
      amountInWords: '',
    });
    
    // Reset images and signature
    attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
    setAttachedImages([]);
    setHasSignature(false);
    setSignatureDataUrl(null);
    setImagesOptional(false);
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Toaster />
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-primary mx-auto" />
            <h2 className="text-xl font-bold">{t.success}</h2>
            <p className="text-muted-foreground">
              {t.successMessage}
            </p>
            <Button onClick={handleCreateAnother} variant="outline">
              {t.createAnother}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Navigation helper: push to history
  const navigateTo = (screen: NavigationScreen) => {
    setNavigationHistory(prev => [...prev, screen]);
  };

  // Navigation helper: go back
  const goBack = () => {
    setNavigationHistory(prev => {
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
    
    // Get the previous screen (before current)
    const prevScreen = navigationHistory.length > 1 ? navigationHistory[navigationHistory.length - 2] : 'login';
    
    // Reset form state
    setAttachedImages([]);
    setHasSignature(false);
    setSignatureDataUrl(null);
    clearSignature();
    
    switch (prevScreen) {
      case 'login':
        setIsAuthenticated(false);
        setShowPendingSelection(false);
        setContinuingPayout(null);
        break;
      case 'pending':
        // Go back to pending selection - need to set isAuthenticated false
        // to show the pending selection screen (which is inside !isAuthenticated block)
        setIsAuthenticated(false);
        setShowPendingSelection(true);
        setContinuingPayout(null);
        break;
      case 'form':
        setShowPendingSelection(false);
        setContinuingPayout(null);
        setIsAuthenticated(true);
        break;
      case 'continuing':
        // This case shouldn't normally happen
        break;
    }
  };

  // Authentication form
  if (!isAuthenticated) {
    const handleAuth = async () => {
      if (!submitterFirstName.trim() || !submitterLastName.trim()) return;
      
      const fullName = `${submitterFirstName.trim()} ${submitterLastName.trim()}`;
      
      setIsCheckingPending(true);
      
      try {
        // Check for pending payouts (transactions without images)
        const { data, error } = await supabase.functions.invoke('check-pending-payouts', {
          body: { 
            token, 
            submitterName: fullName 
          }
        });
        
        if (error) {
          console.error('Error checking pending payouts:', error);
          // Continue anyway if check fails
          setIsAuthenticated(true);
          setFormData(prev => ({ ...prev, issuedTo: fullName }));
          navigateTo('form');
          return;
        }
        
        if (data?.pendingPayouts && data.pendingPayouts.length > 0) {
          setPendingPayouts(data.pendingPayouts);
          setShowPendingSelection(true);
          navigateTo('pending');
        } else {
          setIsAuthenticated(true);
          setFormData(prev => ({ ...prev, issuedTo: fullName }));
          navigateTo('form');
        }
      } catch (err) {
        console.error('Error checking pending:', err);
        // Continue anyway
        setIsAuthenticated(true);
        setFormData(prev => ({ ...prev, issuedTo: fullName }));
        navigateTo('form');
      } finally {
        setIsCheckingPending(false);
      }
    };

    const handleSelectPending = (payout: PendingPayout) => {
      setContinuingPayout(payout);
      setShowPendingSelection(false);
      setIsAuthenticated(true);
      navigateTo('continuing');
      
      // Pre-fill form with existing transaction data
      const category = categories.find(c => c.id === payout.category_id);
      const cleanDescription = payout.description?.replace(/\s*\[Bez załączników - [^\]]+\]/g, '').trim() || '';
      
      setFormData({
        date: new Date(payout.date),
        currency: payout.currency,
        amount: payout.amount.toString(),
        issuedTo: payout.issued_to || `${submitterFirstName.trim()} ${submitterLastName.trim()}`,
        bankAccount: '',
        departmentName: category?.name || '',
        basis: cleanDescription,
        amountInWords: payout.amount_in_words || '',
      });
      
      // Force images required for continuation
      setImagesOptional(false);
    };

    const handleCreateNew = () => {
      setShowPendingSelection(false);
      setIsAuthenticated(true);
      navigateTo('form');
      setFormData(prev => ({
        ...prev,
        issuedTo: `${submitterFirstName.trim()} ${submitterLastName.trim()}`
      }));
    };

    const handleBackToLogin = () => {
      goBack();
    };
    if (showPendingSelection && pendingPayouts.length > 0) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Toaster />
          <Card className="max-w-lg w-full shadow-lg">
            <CardHeader className="text-center border-b pb-4">
              <div className="flex justify-end mb-2">
                <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                  <SelectTrigger className="w-[140px] bg-card border-border">
                    <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        <span>{languageFlags[language]}</span>
                        <span>{LANGUAGE_NAMES[language]}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(['pl', 'ru', 'en', 'uk'] as Language[]).map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        <span className="flex items-center gap-2">
                          <span>{languageFlags[lang]}</span>
                          <span>{LANGUAGE_NAMES[lang]}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
                {t.title}
              </CardTitle>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {t.subtitle}
              </p>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold">{t.foundDocuments}</h3>
                <p className="text-sm text-muted-foreground">
                  {t.selectDocument}
                </p>
              </div>
              
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {pendingPayouts.map((payout) => {
                  const cleanDesc = payout.description?.replace(/\s*\[Bez załączników - [^\]]+\]/g, '').trim() || '';
                  const currencySymbol = currencies.find(c => c.value === payout.currency)?.label || payout.currency;
                  
                  return (
                    <button
                      key={payout.id}
                      onClick={() => handleSelectPending(payout)}
                      className="w-full p-3 text-left border border-border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">{cleanDesc || t.noDescription}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(payout.date), 'dd.MM.yyyy')}
                          </p>
                        </div>
                        <span className="font-semibold text-primary">
                          {currencySymbol} {payout.amount.toFixed(2)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
              
              <div className="border-t pt-4 space-y-3">
                <Button
                  onClick={handleCreateNew}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  {t.createNew}
                </Button>
                <Button
                  onClick={handleBackToLogin}
                  variant="ghost"
                  className="w-full"
                  size="lg"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  {t.back}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Toaster />
        <Card className="max-w-md w-full shadow-lg">
          <CardHeader className="text-center border-b pb-4">
            <div className="flex justify-end mb-2">
              <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                <SelectTrigger className="w-[140px] bg-card border-border">
                  <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue>
                    <span className="flex items-center gap-2">
                      <span>{languageFlags[language]}</span>
                      <span>{LANGUAGE_NAMES[language]}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(['pl', 'ru', 'en', 'uk'] as Language[]).map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      <span className="flex items-center gap-2">
                        <span>{languageFlags[lang]}</span>
                        <span>{LANGUAGE_NAMES[lang]}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
              {t.title}
            </CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              {t.subtitle}
            </p>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold">{t.enterData}</h3>
              <p className="text-sm text-muted-foreground">
                {t.enterDataDesc}
              </p>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">{t.firstName} *</Label>
                <Input
                  id="firstName"
                  placeholder={t.enterFirstName}
                  value={submitterFirstName}
                  onChange={(e) => setSubmitterFirstName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  disabled={isCheckingPending}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="lastName">{t.lastName} *</Label>
                <Input
                  id="lastName"
                  placeholder={t.enterLastName}
                  value={submitterLastName}
                  onChange={(e) => setSubmitterLastName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  disabled={isCheckingPending}
                />
              </div>
            </div>
            
            <Button
              onClick={handleAuth}
              disabled={!submitterFirstName.trim() || !submitterLastName.trim() || isCheckingPending}
              className="w-full"
              size="lg"
            >
              {isCheckingPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t.checking}
                </>
              ) : (
                t.continue
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <Toaster />
      <div className="max-w-3xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader className="border-b pb-4">
            <div className="flex items-center justify-between">
              <div className="flex-1" />
              <div className="text-center flex-1">
                <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
                  {continuingPayout ? t.addPhotosTitle : t.title}
                </CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  {t.subtitle}
                </p>
              </div>
              <div className="flex-1 flex justify-end">
                <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                  <SelectTrigger className="w-[140px] bg-card border-border">
                    <Globe className="w-4 h-4 mr-2 text-muted-foreground" />
                    <SelectValue>
                      <span className="flex items-center gap-2">
                        <span>{languageFlags[language]}</span>
                        <span>{LANGUAGE_NAMES[language]}</span>
                      </span>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(['pl', 'ru', 'en', 'uk'] as Language[]).map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        <span className="flex items-center gap-2">
                          <span>{languageFlags[lang]}</span>
                          <span>{LANGUAGE_NAMES[lang]}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="pt-6 space-y-6">
            {/* Stepwise mode - progress indicator + navigation buttons */}
            {linkType === 'stepwise' && !continuingPayout && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t.step} {currentStep} / {totalSteps}</span>
                  <span className="font-medium">
                    {currentStep === 1 && t.stepBasicInfo}
                    {currentStep === 2 && t.stepCategory}
                    {currentStep === 3 && t.stepPhotos}
                    {currentStep === 4 && t.stepSignature}
                    {currentStep === 5 && t.stepReview}
                  </span>
                </div>
                <Progress value={(currentStep / totalSteps) * 100} className="h-2" />
                
                {/* Navigation buttons right below progress bar */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  <Button
                    onClick={() => {
                      if (currentStep > 1) {
                        setCurrentStep(currentStep - 1);
                      } else {
                        goBack();
                      }
                    }}
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t.back}
                  </Button>

                  {currentStep < totalSteps && (
                    <Button
                      onClick={() => setCurrentStep(currentStep + 1)}
                      disabled={
                        (currentStep === 1 && (!formData.amount || !formData.issuedTo)) ||
                        (currentStep === 2 && (!formData.departmentName || !formData.basis)) ||
                        (currentStep === 3 && (!imagesOptional && attachedImages.length === 0)) ||
                        (currentStep === 4 && !hasSignature)
                      }
                      size="sm"
                      className="gap-1"
                    >
                      {t.next}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  )}

                  {currentStep === totalSteps && (
                    <Button
                      onClick={handleSubmit}
                      disabled={!isFormValid || !hasSignature || isSaving || !fontLoaded}
                      size="sm"
                      className="gap-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {t.downloadPdf}
                    </Button>
                  )}
                </div>
              </div>
            )}
            
            {/* Continuing payout - simplified view */}
            {continuingPayout ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <Button
                    onClick={goBack}
                    variant="ghost"
                    size="sm"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t.back}
                  </Button>
                </div>
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <p className="text-sm font-medium">{t.documentData}</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">{t.date}:</span>
                    <span>{format(formData.date, 'dd.MM.yyyy')}</span>
                    <span className="text-muted-foreground">{t.amount}:</span>
                    <span>{currencies.find(c => c.value === formData.currency)?.label} {formData.amount}</span>
                    <span className="text-muted-foreground">{t.recipient}</span>
                    <span>{formData.issuedTo}</span>
                    <span className="text-muted-foreground">{t.basisLabel}</span>
                    <span>{formData.basis}</span>
                  </div>
                </div>
                
                {/* Image Attachments - Required for continuation */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>{t.attachments} *</Label>
                    <span className="text-xs text-muted-foreground">{t.required}</span>
                  </div>
                  
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageSelect}
                      className="hidden"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full border-dashed"
                    >
                      <ImagePlus className="w-4 h-4 mr-2" />
                      {t.addPhotos}
                    </Button>
                    
                    {attachedImages.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                        {attachedImages.map((img, index) => (
                          <div key={index} className="relative group">
                            <img
                              src={img.preview}
                              alt={`${t.attachments} ${index + 1}`}
                              className="w-full h-20 object-cover rounded-lg border border-border"
                            />
                            <button
                              type="button"
                              onClick={() => removeImage(index)}
                              className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {t.photoNote}
                    </p>
                  </div>
                </div>
                
                {/* Signature - Required for continuation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>{t.signature} *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearSignature}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Eraser className="w-4 h-4 mr-1" />
                      {t.clear}
                    </Button>
                  </div>
                  <div className="border-2 border-dashed rounded-lg bg-white">
                    <canvas
                      ref={signatureCanvasRef}
                      width={600}
                      height={150}
                      className="w-full h-32 cursor-crosshair touch-none rounded-lg"
                      style={{ backgroundColor: 'white' }}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                    />
                  </div>
                </div>
                
                {/* Submit Button */}
                <div className="flex">
                  <Button
                    onClick={handleSubmit}
                    disabled={!isFormValid || !hasSignature || isSaving || !fontLoaded}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                    size="lg"
                  >
                    {isSaving ? (
                      <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-5 h-5 mr-2" />
                    )}
                    {t.saveAndDownload}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Back button removed - moved to navigation row */}
                
                {/* Standard mode OR Stepwise Step 1: Basic Info */}
                {(linkType === 'standard' || currentStep === 1) && (
                  <>
                    <p className="text-sm text-muted-foreground">{t.requiredFields}</p>
                    
                    {/* Date, Currency, Amount, Issued To */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>{t.date} *</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                'w-full justify-start text-left font-normal',
                                !formData.date && 'text-muted-foreground'
                              )}
                            >
                              <Calendar className="mr-2 h-4 w-4" />
                              {format(formData.date, 'dd.MM.yyyy')}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0">
                            <CalendarComponent
                              mode="single"
                              selected={formData.date}
                              onSelect={(date) => date && handleInputChange('date', date)}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      
                      <div className="space-y-2">
                        <Label>{t.amount} *</Label>
                        <div className="flex gap-2">
                          <Select value={formData.currency} onValueChange={(v) => handleInputChange('currency', v)}>
                            <SelectTrigger className="w-20">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {currencies.map(c => (
                                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={formData.amount}
                            onChange={(e) => handleInputChange('amount', e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => setShowConverter(true)}
                            title={t.amount}
                          >
                            <img src={currencyConvertIcon} alt="Convert" className="w-5 h-5" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* Currency Converter Dialog */}
                      <CurrencyConverter
                        isOpen={showConverter}
                        onClose={() => setShowConverter(false)}
                        onApply={(amount, currency) => {
                          handleInputChange('amount', amount);
                          handleInputChange('currency', currency);
                        }}
                        currentAmount={formData.amount}
                        currentCurrency={formData.currency}
                        language={language}
                      />
                      
                      <div className="space-y-2">
                        <Label>{t.issuedTo} *</Label>
                        <Input
                          placeholder={t.enterName}
                          value={formData.issuedTo}
                          onChange={(e) => handleInputChange('issuedTo', e.target.value)}
                        />
                      </div>
                    </div>
                    
                    {/* Bank Account - digits and + only */}
                    <div className="space-y-2">
                      <Label>{t.bankAccount}</Label>
                      <Input
                        placeholder={t.bankAccountPlaceholder}
                        value={formData.bankAccount}
                        inputMode="tel"
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9+]/g, '');
                          handleInputChange('bankAccount', val);
                        }}
                      />
                    </div>
                  </>
                )}
                
                {/* Standard mode OR Stepwise Step 2: Category & Basis */}
                {(linkType === 'standard' || currentStep === 2) && (
                  <>
                    {/* Department Name */}
                    <div className="space-y-2">
                      <Label>{t.department} *</Label>
                      <Select 
                        value={formData.departmentName} 
                        onValueChange={(v) => handleInputChange('departmentName', v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t.selectCategory} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.name}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Basis */}
                    <div className="space-y-2">
                      <Label>{t.basis} *</Label>
                      <Textarea
                        placeholder={t.basisPlaceholder}
                        value={formData.basis}
                        onChange={(e) => handleInputChange('basis', e.target.value)}
                        rows={3}
                      />
                    </div>
                    
                    {/* Amount in Words */}
                    <div className="space-y-2">
                      <Label>{t.amountInWords} *</Label>
                      <Textarea
                        value={formData.amountInWords}
                        readOnly
                        rows={2}
                        className="bg-muted cursor-not-allowed"
                      />
                    </div>
                  </>
                )}
                
                {/* Standard mode OR Stepwise Step 3: Photos only */}
                {(linkType === 'standard' || currentStep === 3) && (
                  <>
                    {/* Image Attachments Toggle */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="allow-images-public">{t.attachments} {!imagesOptional && '*'}</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{imagesOptional ? t.optional : t.required}</span>
                          <Switch
                            id="allow-images-public"
                            checked={imagesOptional}
                            onCheckedChange={(checked) => {
                              setImagesOptional(checked);
                              if (checked) {
                                attachedImages.forEach(img => URL.revokeObjectURL(img.preview));
                                setAttachedImages([]);
                              }
                            }}
                          />
                        </div>
                      </div>
                      
                      <div className={cn(
                        "transition-all duration-200",
                        imagesOptional && "opacity-50 pointer-events-none"
                      )}>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleImageSelect}
                          className="hidden"
                          disabled={imagesOptional}
                        />
                        {/* Wide, prominent photo button */}
                        <button
                          type="button"
                          onClick={() => !imagesOptional && fileInputRef.current?.click()}
                          disabled={imagesOptional}
                          className={cn(
                            "w-full flex flex-col items-center justify-center gap-2 py-6 px-4 rounded-xl border-2 border-dashed transition-all duration-200",
                            imagesOptional
                              ? "border-border text-muted-foreground cursor-not-allowed"
                              : "border-primary/50 text-primary hover:border-primary hover:bg-primary/5 active:bg-primary/10 cursor-pointer"
                          )}
                        >
                          <ImagePlus className="w-8 h-8" />
                          <span className="text-base font-semibold">{t.addPhotos}</span>
                          <span className="text-xs text-muted-foreground">{t.photoNote}</span>
                        </button>
                        
                        {attachedImages.length > 0 && (
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                            {attachedImages.map((img, index) => (
                              <div key={index} className="relative group">
                                <img
                                  src={img.preview}
                                  alt={`${t.attachments} ${index + 1}`}
                                  className="w-full h-24 object-cover rounded-lg border border-border"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeImage(index)}
                                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 shadow-md"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
                
                {/* Standard mode OR Stepwise Step 4: Signature only */}
                {(linkType === 'standard' || currentStep === 4) && (
                  <>
                    {/* Signature */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>{t.signature} *</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={clearSignature}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Eraser className="w-4 h-4 mr-1" />
                          {t.clear}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Нарисуйте подпись пальцем в поле ниже</p>
                      <div className="border-2 border-dashed border-primary/40 rounded-xl bg-white overflow-hidden"
                        style={{ touchAction: 'none' }}
                      >
                        <canvas
                          ref={signatureCanvasRef}
                          width={600}
                          height={200}
                          className="w-full h-40 cursor-crosshair rounded-xl"
                          style={{ backgroundColor: 'white', touchAction: 'none', display: 'block' }}
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={(e) => { e.preventDefault(); startDrawing(e); }}
                          onTouchMove={(e) => { e.preventDefault(); draw(e); }}
                          onTouchEnd={(e) => { e.preventDefault(); stopDrawing(); }}
                        />
                      </div>
                      {hasSignature && <p className="text-xs text-success">✓ Подпись добавлена</p>}
                    </div>
                  </>
                )}
                
                {/* Stepwise Step 4: Review */}
                {linkType === 'stepwise' && currentStep === 5 && (
                  <div className="space-y-4">
                    <h3 className="font-semibold">{t.reviewTitle}</h3>
                    <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <span className="text-muted-foreground">{t.date}:</span>
                        <span>{format(formData.date, 'dd.MM.yyyy')}</span>
                        
                        <span className="text-muted-foreground">{t.amount}:</span>
                        <span>{currencies.find(c => c.value === formData.currency)?.label} {formData.amount}</span>
                        
                        <span className="text-muted-foreground">{t.issuedTo}:</span>
                        <span>{formData.issuedTo}</span>
                        
                        {formData.bankAccount && (
                          <>
                            <span className="text-muted-foreground">{t.bankAccount}:</span>
                            <span>{formData.bankAccount}</span>
                          </>
                        )}
                        
                        <span className="text-muted-foreground">{t.department}:</span>
                        <span>{formData.departmentName}</span>
                        
                        <span className="text-muted-foreground">{t.basis}:</span>
                        <span className="col-span-1">{formData.basis}</span>
                      </div>
                      
                      <div className="pt-2 border-t">
                        <span className="text-muted-foreground text-sm">{t.amountInWords}:</span>
                        <p className="font-medium">{formData.amountInWords}</p>
                      </div>
                      
                      {attachedImages.length > 0 && (
                        <div className="pt-2 border-t">
                          <span className="text-muted-foreground text-sm">{t.attachments}: {attachedImages.length}</span>
                        </div>
                      )}
                      
                      {hasSignature && (
                        <div className="pt-2 border-t">
                          <span className="text-muted-foreground text-sm">{t.signature}: ✓</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Navigation Buttons - standard mode only (stepwise uses buttons near progress bar) */}
                {linkType !== 'stepwise' && (
                  <div className="flex items-center justify-between gap-3 pt-4">
                    <Button
                      onClick={goBack}
                      variant="ghost"
                      size="lg"
                      className="gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      {t.back}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={!isFormValid || !hasSignature || isSaving || !fontLoaded}
                      className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                      size="lg"
                    >
                      {isSaving ? (
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-5 h-5 mr-2" />
                      )}
                      {t.saveAndDownload}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicPayout;