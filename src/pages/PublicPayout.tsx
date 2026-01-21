import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar, Eraser, Save, Loader2, CheckCircle, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Currency, CURRENCY_SYMBOLS } from '@/types/transaction';

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
  
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

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

  // Load shared link and categories
  useEffect(() => {
    const loadData = async () => {
      if (!token) {
        setError('Nieprawidłowy link');
        setLoading(false);
        return;
      }

      try {
        // Fetch shared link
        const { data: linkData, error: linkError } = await supabase
          .from('shared_payout_links')
          .select('*')
          .eq('token', token)
          .eq('is_active', true)
          .maybeSingle();

        if (linkError) throw linkError;
        if (!linkData) {
          setError('Link jest nieaktywny lub nie istnieje');
          setLoading(false);
          return;
        }

        // Check expiration
        if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
          setError('Link wygasł');
          setLoading(false);
          return;
        }

        setSharedLink(linkData);

        // Fetch expense categories for the owner
        const { data: catData, error: catError } = await supabase
          .from('categories')
          .select('*')
          .eq('user_id', linkData.owner_user_id)
          .eq('type', 'expense')
          .order('sort_order');

        if (catError) throw catError;
        setCategories(catData || []);
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
        const words = numberToWords(numAmount, formData.currency, 'pl');
        setFormData(prev => ({ ...prev, amountInWords: words }));
      }
    } else {
      setFormData(prev => ({ ...prev, amountInWords: '' }));
    }
  }, [formData.amount, formData.currency]);

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
    
    doc.setFontSize(18);
    doc.text('Dowód wypłaty', pageWidth / 2, 25, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text('ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE', pageWidth / 2, 35, { align: 'center' });
    
    let yPos = 55;
    const leftMargin = 20;
    const labelWidth = 60;
    
    doc.setFontSize(11);
    
    doc.text('Data:', leftMargin, yPos);
    doc.text(format(formData.date, 'dd.MM.yyyy'), leftMargin + labelWidth, yPos);
    yPos += 10;
    
    doc.text('Suma:', leftMargin, yPos);
    const currencySymbol = currencies.find(c => c.value === formData.currency)?.label || formData.currency;
    doc.text(`${currencySymbol} ${formData.amount}`, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    doc.text('Wydano (imię i nazwisko):', leftMargin, yPos);
    doc.text(formData.issuedTo, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    doc.text('Konto do przelewu:', leftMargin, yPos);
    const bankLines = doc.splitTextToSize(formData.bankAccount, pageWidth - leftMargin - labelWidth - 20);
    doc.text(bankLines, leftMargin + labelWidth, yPos);
    yPos += bankLines.length * 7 + 3;
    
    doc.text('Nazwa oddziału:', leftMargin, yPos);
    doc.text(formData.departmentName, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    doc.text('Podstawa (na jakie potrzeby):', leftMargin, yPos);
    yPos += 7;
    const basisLines = doc.splitTextToSize(formData.basis, pageWidth - leftMargin * 2);
    doc.text(basisLines, leftMargin, yPos);
    yPos += basisLines.length * 7 + 3;
    
    doc.text('Suma słownie:', leftMargin, yPos);
    yPos += 7;
    const wordsLines = doc.splitTextToSize(formData.amountInWords, pageWidth - leftMargin * 2);
    doc.text(wordsLines, leftMargin, yPos);
    yPos += wordsLines.length * 7 + 10;
    
    doc.text('Podpis odbiorcy:', leftMargin, yPos);
    yPos += 5;
    
    if (hasSignature && signatureCanvasRef.current) {
      const signatureData = signatureCanvasRef.current.toDataURL('image/png');
      doc.addImage(signatureData, 'PNG', leftMargin, yPos, 80, 30);
    }

    // Add each attached image on a new page
    for (const img of attachedImages) {
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
      
      // Calculate dimensions to fit within page margins
      const maxWidth = pageWidth - 2 * leftMargin;
      const maxHeight = pageHeight - 40; // 20mm margin top and bottom
      
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
    
    const fileName = `dowod_wyplaty_${format(formData.date, 'yyyy-MM-dd')}_${formData.issuedTo.replace(/\s/g, '_') || 'dokument'}.pdf`;
    doc.save(fileName);
  };

  const handleSubmit = async () => {
    if (!sharedLink) return;

    setIsSaving(true);

    try {
      // Find category ID by name
      const category = categories.find(c => c.name === formData.departmentName);

      // Insert transaction for the owner
      const { error: insertError } = await supabase
        .from('transactions')
        .insert({
          user_id: sharedLink.owner_user_id,
          type: 'expense',
          amount: parseFloat(formData.amount),
          currency: formData.currency,
          category_id: category?.id || null,
          description: formData.basis,
          date: format(formData.date, 'yyyy-MM-dd'),
          issued_to: formData.issuedTo,
          amount_in_words: formData.amountInWords,
        });

      if (insertError) throw insertError;

      // Generate PDF
      await generatePDF();

      setIsSuccess(true);
      toast({
        title: 'Zapisano!',
        description: 'Dokument został zapisany i pobrany',
      });
    } catch (err) {
      console.error('Save error:', err);
      toast({
        title: 'Błąd',
        description: 'Nie udało się zapisać dokumentu',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const isFormValid = formData.amount && formData.issuedTo && formData.departmentName && formData.basis && formData.amountInWords;

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
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
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

  return (
    <div className="min-h-screen bg-background p-4">
      <Toaster />
      <div className="max-w-3xl mx-auto">
        <Card className="shadow-lg">
          <CardHeader className="text-center border-b pb-4">
            <CardTitle className="text-xl sm:text-2xl font-bold text-primary">
              Dowód wypłaty
            </CardTitle>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE
            </p>
          </CardHeader>
          
          <CardContent className="pt-6 space-y-6">
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
            
            {/* Image Attachments */}
            <div className="space-y-2">
              <Label>Załączniki (zdjęcia)</Label>
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
              <p className="text-xs text-muted-foreground">
                Każde zdjęcie zostanie umieszczone na osobnej stronie PDF
              </p>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicPayout;