import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, Eraser, Save, Loader2, ImagePlus, X } from 'lucide-react';
import currencyConvertIcon from '@/assets/currency-convert-icon.png';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { useTranslation } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import { useSupabaseTransactions } from '@/hooks/useSupabaseTransactions';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';
import { CurrencyConverter } from '@/components/CurrencyConverter';

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

// Number to words conversion for multiple languages
const numberToWords = (num: number, currency: string, lang: string): string => {
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

  const l = lang in ones ? lang : 'en';
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

export const PayoutGenerator = () => {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { addTransaction } = useSupabaseTransactions();
  const { getExpenseCategories } = useSupabaseCategories();
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [fontBase64, setFontBase64] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [imagesOptional, setImagesOptional] = useState(false); // false = images required by default
  const [showConverter, setShowConverter] = useState(false);
  
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

  // Auto-generate amount in words when amount or currency changes
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

  // Load Roboto font for PDF
  useEffect(() => {
    const loadFont = async () => {
      try {
        const base64 = await loadFontAsBase64('/fonts/Roboto-Regular.ttf');
        setFontBase64(base64);
        setFontLoaded(true);
      } catch (error) {
        console.error('Failed to load font:', error);
        setFontLoaded(true); // Continue without custom font
      }
    };
    loadFont();
  }, []);

  const currencies = [
    { value: 'PLN', label: 'zł' },
    { value: 'EUR', label: '€' },
    { value: 'USD', label: '$' },
    { value: 'UAH', label: '₴' },
    { value: 'RUB', label: '₽' },
    { value: 'BYN', label: 'Br' },
  ];

  const handleInputChange = (field: keyof PayoutFormData, value: string | Date) => {
    if (field === 'amountInWords') return; // Prevent manual editing
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
    
    // Add custom font for Cyrillic/Polish support
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
      
      const format = img.file.type.includes('png') ? 'PNG' : 'JPEG';
      doc.addImage(imageData, format, xPos, imgYPos, finalWidth, finalHeight);
    }
    
    // Save PDF
    const fileName = `dowod_wyplaty_${format(formData.date, 'yyyy-MM-dd')}_${formData.issuedTo.replace(/\s/g, '_') || 'dokument'}.pdf`;
    doc.save(fileName);
  };

  // Save transaction to database and sync to Google Sheets
  const saveAsTransaction = async () => {
    if (!user) {
      toast({
        title: 'Ошибка',
        description: 'Пожалуйста, войдите в систему',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    
    try {
      // Get expense categories and find "other" or first available
      const expenseCategories = getExpenseCategories();
      const categoryId = expenseCategories.find(c => c.name.toLowerCase().includes('other') || c.name.toLowerCase().includes('inne') || c.name.toLowerCase().includes('другое'))?.id 
        || expenseCategories[0]?.id 
        || 'other';

      // Add transaction to database
      await addTransaction({
        type: 'expense',
        amount: parseFloat(formData.amount),
        currency: formData.currency as Currency,
        category: categoryId as any,
        description: formData.basis,
        date: formData.date,
        issuedTo: formData.issuedTo,
        amountInWords: formData.amountInWords,
      });

      // Sync to Google Sheets if configured
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('spreadsheet_id')
            .eq('user_id', user.id)
            .single();

          // Show success - auto-sync will handle Google Sheets if configured
          toast({
            title: t('payoutGenerateAndSave'),
            description: `${formData.amount} ${CURRENCY_SYMBOLS[formData.currency as Currency]} - ${formData.issuedTo}`,
          });
        }
      } catch (sheetError) {
        console.error('Sheet sync error:', sheetError);
        // Still show success for database save
        toast({
          title: t('payoutGenerateAndSave'),
          description: `${formData.amount} ${CURRENCY_SYMBOLS[formData.currency as Currency]} - ${formData.issuedTo}`,
        });
      }
    } catch (error) {
      console.error('Save error:', error);
      toast({
        title: 'Ошибка сохранения',
        description: error instanceof Error ? error.message : 'Не удалось сохранить транзакцию',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Generate PDF and save transaction
  const handleGenerateAndSave = async () => {
    await generatePDF();
    await saveAsTransaction();
  };

  const isFormValid = formData.amount && formData.issuedTo && formData.departmentName && formData.basis && formData.amountInWords && (imagesOptional || attachedImages.length > 0);

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <Card className="shadow-card">
        <CardHeader className="text-center border-b border-border pb-4">
          <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
            {t('payoutGeneratorTitle')}
          </CardTitle>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE
          </p>
        </CardHeader>
        
        <CardContent className="pt-6 space-y-6">
          <p className="text-sm text-muted-foreground">* {t('requiredFields')}</p>
          
          {/* Date, Currency, Amount, Issued To - Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Date */}
            <div className="space-y-2">
              <Label>{t('date')} *</Label>
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
            
            {/* Amount with Currency */}
            <div className="space-y-2">
              <Label>{t('amount')} *</Label>
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
                  title={t('convertCurrency')}
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
            
            {/* Issued To */}
            <div className="space-y-2">
              <Label>{t('payoutIssuedTo')} *</Label>
              <Input
                placeholder={t('enterIssuedTo')}
                value={formData.issuedTo}
                onChange={(e) => handleInputChange('issuedTo', e.target.value)}
              />
            </div>
          </div>
          
          {/* Bank Account */}
          <div className="space-y-2">
            <Label>{t('payoutBankAccount')}</Label>
            <Input
              placeholder={t('payoutBankAccountPlaceholder')}
              value={formData.bankAccount}
              onChange={(e) => handleInputChange('bankAccount', e.target.value)}
            />
          </div>
          
          {/* Department Name - Select from expense categories */}
          <div className="space-y-2">
            <Label>{t('payoutDepartmentName')} *</Label>
            <Select 
              value={formData.departmentName} 
              onValueChange={(v) => handleInputChange('departmentName', v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t('selectCategory')} />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {getExpenseCategories().map((category) => (
                  <SelectItem key={category.id} value={category.name}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {/* Basis */}
          <div className="space-y-2">
            <Label>{t('payoutBasis')} *</Label>
            <Textarea
              placeholder={t('payoutBasisPlaceholder')}
              value={formData.basis}
              onChange={(e) => handleInputChange('basis', e.target.value)}
              rows={3}
            />
          </div>
          
          {/* Amount in Words - Auto-generated, read-only */}
          <div className="space-y-2">
            <Label>{t('amountInWords')} *</Label>
            <Textarea
              placeholder={formData.amount ? '' : t('enterAmountInWords')}
              value={formData.amountInWords}
              readOnly
              rows={2}
              className="bg-muted cursor-not-allowed"
            />
          </div>
          
          {/* Image Attachments Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="allow-images">Załączniki (zdjęcia) {!imagesOptional && '*'}</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{imagesOptional ? 'Nieobowiązkowe' : 'Obowiązkowe'}</span>
                <Switch
                  id="allow-images"
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
              <Label>{t('payoutSignature')} *</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearSignature}
                className="text-muted-foreground hover:text-foreground"
              >
                <Eraser className="w-4 h-4 mr-1" />
                {t('payoutClearSignature')}
              </Button>
            </div>
            <div className="border-2 border-dashed border-border rounded-lg bg-white">
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
          
          {/* Button */}
          <div className="flex">
            <Button
              onClick={handleGenerateAndSave}
              disabled={!isFormValid || !hasSignature || isSaving || !fontLoaded}
              className="w-full gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200"
              size="lg"
            >
              {isSaving ? (
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              ) : (
                <Save className="w-5 h-5 mr-2" />
              )}
              {t('payoutGenerateAndSave')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
