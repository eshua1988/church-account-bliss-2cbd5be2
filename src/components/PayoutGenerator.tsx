import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { Calendar, Eraser, Download, Save, Loader2 } from 'lucide-react';
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

export const PayoutGenerator = () => {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { addTransaction } = useSupabaseTransactions();
  const { getExpenseCategories } = useSupabaseCategories();
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [fontBase64, setFontBase64] = useState<string | null>(null);
  
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

  const generatePDF = () => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Add custom font for Cyrillic/Polish support
    if (fontBase64) {
      doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.setFont('Roboto');
    }
    
    // Title
    doc.setFontSize(18);
    doc.text('Dowód wypłaty', pageWidth / 2, 25, { align: 'center' });
    
    // Subtitle
    doc.setFontSize(10);
    doc.text('ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE', pageWidth / 2, 35, { align: 'center' });
    
    let yPos = 55;
    const leftMargin = 20;
    const labelWidth = 60;
    
    doc.setFontSize(11);
    
    // Date
    doc.text('Data:', leftMargin, yPos);
    doc.text(format(formData.date, 'dd.MM.yyyy'), leftMargin + labelWidth, yPos);
    yPos += 10;
    
    // Amount with currency
    doc.text('Suma:', leftMargin, yPos);
    const currencySymbol = currencies.find(c => c.value === formData.currency)?.label || formData.currency;
    doc.text(`${currencySymbol} ${formData.amount}`, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    // Issued to
    doc.text('Wydano (imię i nazwisko):', leftMargin, yPos);
    doc.text(formData.issuedTo, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    // Bank account
    doc.text('Konto do przelewu:', leftMargin, yPos);
    const bankLines = doc.splitTextToSize(formData.bankAccount, pageWidth - leftMargin - labelWidth - 20);
    doc.text(bankLines, leftMargin + labelWidth, yPos);
    yPos += bankLines.length * 7 + 3;
    
    // Department name
    doc.text('Nazwa oddziału:', leftMargin, yPos);
    doc.text(formData.departmentName, leftMargin + labelWidth, yPos);
    yPos += 10;
    
    // Basis
    doc.text('Podstawa (na jakie potrzeby):', leftMargin, yPos);
    yPos += 7;
    const basisLines = doc.splitTextToSize(formData.basis, pageWidth - leftMargin * 2);
    doc.text(basisLines, leftMargin, yPos);
    yPos += basisLines.length * 7 + 3;
    
    // Amount in words
    doc.text('Suma słownie:', leftMargin, yPos);
    yPos += 7;
    const wordsLines = doc.splitTextToSize(formData.amountInWords, pageWidth - leftMargin * 2);
    doc.text(wordsLines, leftMargin, yPos);
    yPos += wordsLines.length * 7 + 10;
    
    // Signature
    doc.text('Podpis odbiorcy:', leftMargin, yPos);
    yPos += 5;
    
    if (hasSignature && signatureCanvasRef.current) {
      const signatureData = signatureCanvasRef.current.toDataURL('image/png');
      doc.addImage(signatureData, 'PNG', leftMargin, yPos, 80, 30);
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
    generatePDF();
    await saveAsTransaction();
  };

  const isFormValid = formData.amount && formData.issuedTo && formData.departmentName && formData.basis && formData.amountInWords;

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
              </div>
            </div>
            
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
          
          {/* Department Name */}
          <div className="space-y-2">
            <Label>{t('payoutDepartmentName')} *</Label>
            <Input
              placeholder={t('payoutDepartmentPlaceholder')}
              value={formData.departmentName}
              onChange={(e) => handleInputChange('departmentName', e.target.value)}
            />
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
          
          {/* Amount in Words */}
          <div className="space-y-2">
            <Label>{t('amountInWords')} *</Label>
            <Textarea
              placeholder={t('enterAmountInWords')}
              value={formData.amountInWords}
              onChange={(e) => handleInputChange('amountInWords', e.target.value)}
              rows={2}
            />
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
            <div className="border-2 border-dashed border-border rounded-lg bg-background">
              <canvas
                ref={signatureCanvasRef}
                width={600}
                height={150}
                className="w-full h-32 cursor-crosshair touch-none"
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
          
          {/* Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={generatePDF}
              disabled={!isFormValid || !hasSignature || !fontLoaded}
              variant="outline"
              className="flex-1"
              size="lg"
            >
              <Download className="w-5 h-5 mr-2" />
              {t('payoutGeneratePDF')}
            </Button>
            
            <Button
              onClick={handleGenerateAndSave}
              disabled={!isFormValid || !hasSignature || isSaving || !fontLoaded}
              className="flex-1 gradient-primary text-primary-foreground font-semibold shadow-glow hover:shadow-lg transition-all duration-200"
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
