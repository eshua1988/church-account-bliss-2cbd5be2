import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Eraser, Save, Loader2, CheckCircle, ImagePlus, X, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';

type Language = 'pl' | 'ru' | 'en' | 'uk';

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
    const copeckWords: Record<string, string> = {
      pl: 'groszy',
      ru: 'копеек',
      uk: 'копійок',
      en: 'cents',
    };
    result += ` ${decPart}/100 ${copeckWords[l] || 'cents'}`;
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
  
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [language, setLanguage] = useState<Language>('pl');
  const [imagesOptional, setImagesOptional] = useState(false); // false = images required by default

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
  };

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
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
    
    if (hasSignature && signatureCanvasRef.current) {
      const signatureData = signatureCanvasRef.current.toDataURL('image/png');
      doc.addImage(signatureData, 'PNG', leftMargin + 5, yPos + 2, signatureBoxWidth - 10, signatureBoxHeight - 4);
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
    doc.save(fileName);
  };

  const handleSubmit = async () => {
    if (!token) return;

    setIsSaving(true);

    try {
      // If continuing an existing payout, update it instead of creating new
      if (continuingPayout) {
        // Update the existing transaction to mark images as added
        const { data: updateData, error: updateError } = await supabase.functions.invoke('add-images-to-payout', {
          body: {
            token,
            transactionId: continuingPayout.id,
            submitterName: `${submitterFirstName} ${submitterLastName}`,
          }
        });

        if (updateError) throw updateError;
        
        if (updateData?.error) {
          throw new Error(updateData.error);
        }
        
        // Generate PDF with images
        await generatePDF();

        setIsSuccess(true);
        toast({
          title: 'Zapisano!',
          description: 'Zdjęcia zostały dodane do dokumentu',
        });
        return;
      }

      // Find category ID by name
      const category = categories.find(c => c.name === formData.departmentName);

      // Submit via secure edge function with validation and rate limiting
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
          submitterName: `${submitterFirstName} ${submitterLastName}`,
          imagesSkipped: imagesOptional,
        }
      });

      if (submitError) throw submitError;
      
      if (data?.error) {
        throw new Error(data.error);
      }

      // Generate PDF
      await generatePDF();

      setIsSuccess(true);
      toast({
        title: 'Zapisano!',
        description: 'Dokument został zapisany i pobrany',
      });
    } catch (err) {
      console.error('Save error:', err);
      const errorMessage = err instanceof Error ? err.message : 'Nie udało się zapisać dokumentu';
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

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Toaster />
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <CheckCircle className="w-16 h-16 text-primary mx-auto" />
            <h2 className="text-xl font-bold">Dziękujemy!</h2>
            <p className="text-muted-foreground">
              Dokument został zapisany i pobrany jako PDF.
            </p>
            <Button onClick={() => setIsSuccess(false)} variant="outline">
              Wypełnić kolejny dokument
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
          return;
        }
        
        if (data?.pendingPayouts && data.pendingPayouts.length > 0) {
          setPendingPayouts(data.pendingPayouts);
          setShowPendingSelection(true);
        } else {
          setIsAuthenticated(true);
          setFormData(prev => ({ ...prev, issuedTo: fullName }));
        }
      } catch (err) {
        console.error('Error checking pending:', err);
        // Continue anyway
        setIsAuthenticated(true);
        setFormData(prev => ({ ...prev, issuedTo: fullName }));
      } finally {
        setIsCheckingPending(false);
      }
    };

    const handleSelectPending = (payout: PendingPayout) => {
      setContinuingPayout(payout);
      setShowPendingSelection(false);
      setIsAuthenticated(true);
      
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
      setPendingPayouts([]);
      setIsAuthenticated(true);
      setFormData(prev => ({
        ...prev,
        issuedTo: `${submitterFirstName.trim()} ${submitterLastName.trim()}`
      }));
    };

    // Show pending selection screen
    if (showPendingSelection && pendingPayouts.length > 0) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Toaster />
          <Card className="max-w-lg w-full shadow-lg">
            <CardHeader className="text-center border-b pb-4">
              <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
                Dowód wypłaty
              </CardTitle>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE
              </p>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div className="text-center mb-4">
                <h3 className="text-lg font-semibold">Znaleźliśmy dokumenty bez zdjęć</h3>
                <p className="text-sm text-muted-foreground">
                  Wybierz dokument, aby dodać zdjęcia, lub utwórz nowy
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
                          <p className="font-medium">{cleanDesc || 'Bez opisu'}</p>
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
              
              <div className="border-t pt-4">
                <Button
                  onClick={handleCreateNew}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  Utwórz nowy dokument
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
            <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
              Dowód wypłaty
            </CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE
            </p>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="text-center mb-4">
              <h3 className="text-lg font-semibold">Wprowadź swoje dane</h3>
              <p className="text-sm text-muted-foreground">
                Aby kontynuować, podaj imię i nazwisko
              </p>
            </div>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="firstName">Imię *</Label>
                <Input
                  id="firstName"
                  placeholder="Wpisz imię..."
                  value={submitterFirstName}
                  onChange={(e) => setSubmitterFirstName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAuth()}
                  disabled={isCheckingPending}
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="lastName">Nazwisko *</Label>
                <Input
                  id="lastName"
                  placeholder="Wpisz nazwisko..."
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
                  Sprawdzanie...
                </>
              ) : (
                'Kontynuuj'
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
                  {continuingPayout ? 'Dodaj zdjęcia do dokumentu' : 'Dowód wypłaty'}
                </CardTitle>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                  ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE
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
            {/* Continuing payout - simplified view */}
            {continuingPayout ? (
              <>
                <div className="bg-muted/50 p-4 rounded-lg space-y-2">
                  <p className="text-sm font-medium">Dane dokumentu:</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Data:</span>
                    <span>{format(formData.date, 'dd.MM.yyyy')}</span>
                    <span className="text-muted-foreground">Kwota:</span>
                    <span>{currencies.find(c => c.value === formData.currency)?.label} {formData.amount}</span>
                    <span className="text-muted-foreground">Odbiorca:</span>
                    <span>{formData.issuedTo}</span>
                    <span className="text-muted-foreground">Podstawa:</span>
                    <span>{formData.basis}</span>
                  </div>
                </div>
                
                {/* Image Attachments - Required for continuation */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Załączniki (zdjęcia) *</Label>
                    <span className="text-xs text-muted-foreground">Obowiązkowe</span>
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
                      Dodaj zdjęcia
                    </Button>
                    
                    {attachedImages.length > 0 && (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                        {attachedImages.map((img, index) => (
                          <div key={index} className="relative group">
                            <img
                              src={img.preview}
                              alt={`Załącznik ${index + 1}`}
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
                      Każde zdjęcie zostanie umieszczone na osobnej stronie PDF
                    </p>
                  </div>
                </div>
                
                {/* Signature - Required for continuation */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Podpis odbiorcy *</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearSignature}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Eraser className="w-4 h-4 mr-1" />
                      Wyczyść
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
                      <Save className="w-5 h-5 mr-2" />
                    )}
                    Zapisz i pobierz PDF
                  </Button>
                </div>
              </>
            ) : (
              <>
            <p className="text-sm text-muted-foreground">* Pola obowiązkowe do wypełnienia</p>
            
            {/* Date, Currency, Amount, Issued To */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Data *</Label>
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
                <Label>Suma *</Label>
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
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Wydano (imię i nazwisko) *</Label>
                <Input
                  placeholder="Wpisz imię i nazwisko..."
                  value={formData.issuedTo}
                  onChange={(e) => handleInputChange('issuedTo', e.target.value)}
                />
              </div>
            </div>
            
            {/* Bank Account */}
            <div className="space-y-2">
              <Label>Konto do przelewu</Label>
              <Input
                placeholder="Wpisz numer konta lub telefonu..."
                value={formData.bankAccount}
                onChange={(e) => handleInputChange('bankAccount', e.target.value)}
              />
            </div>
            
            {/* Department Name */}
            <div className="space-y-2">
              <Label>Nazwa oddziału *</Label>
              <Select 
                value={formData.departmentName} 
                onValueChange={(v) => handleInputChange('departmentName', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Wybierz kategorię" />
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
              <Label>Podstawa (na jakie potrzeby) *</Label>
              <Textarea
                placeholder="Wpisz podstawę wypłaty..."
                value={formData.basis}
                onChange={(e) => handleInputChange('basis', e.target.value)}
                rows={3}
              />
            </div>
            
            {/* Amount in Words */}
            <div className="space-y-2">
              <Label>Suma słownie *</Label>
              <Textarea
                value={formData.amountInWords}
                readOnly
                rows={2}
                className="bg-muted cursor-not-allowed"
              />
            </div>
            
            {/* Image Attachments Toggle */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="allow-images-public">Załączniki (zdjęcia) {!imagesOptional && '*'}</Label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{imagesOptional ? 'Nieobowiązkowe' : 'Obowiązkowe'}</span>
                  <Switch
                    id="allow-images-public"
                    checked={imagesOptional}
                    onCheckedChange={(checked) => {
                      setImagesOptional(checked);
                      if (checked) {
                        // Clear images when making optional
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-dashed"
                  disabled={imagesOptional}
                >
                  <ImagePlus className="w-4 h-4 mr-2" />
                  Dodaj zdjęcia
                </Button>
                
                {attachedImages.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3">
                    {attachedImages.map((img, index) => (
                      <div key={index} className="relative group">
                        <img
                          src={img.preview}
                          alt={`Załącznik ${index + 1}`}
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
                  Każde zdjęcie zostanie umieszczone na osobnej stronie PDF
                </p>
              </div>
            </div>
            {/* Signature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Podpis odbiorcy *</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSignature}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Eraser className="w-4 h-4 mr-1" />
                  Wyczyść
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
                  <Save className="w-5 h-5 mr-2" />
                )}
                Zapisz i pobierz PDF
              </Button>
            </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicPayout;