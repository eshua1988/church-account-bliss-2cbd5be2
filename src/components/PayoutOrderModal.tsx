import { useState, useRef, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { Download, Loader2, Eraser, Edit2, X, Calendar, Save, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { supabase } from '@/integrations/supabase/client';
import { downloadPdfBlob } from '@/lib/pdfDownload';
import { useToast } from '@/hooks/use-toast';
import { useSupabaseCategories } from '@/hooks/useSupabaseCategories';
import jsPDF from 'jspdf';

interface PayoutOrderData {
  id: string;
  date: string;
  amount: number;
  currency: string;
  issued_to: string | null;
  description: string | null;
  amount_in_words: string | null;
  cashier_name: string | null;
  decision_number: string | null;
}

interface PayoutOrderModalProps {
  transactionId: string | null;
  open: boolean;
  onClose: () => void;
  onBack?: () => void; // Optional: show back button (e.g. back to notifications)
  backLabel?: string;
  pdfPath?: string | null; // Storage path to attached PDF
}

const loadFontAsBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const PayoutOrderModal = ({ transactionId, open, onClose, onBack, backLabel, pdfPath }: PayoutOrderModalProps) => {
  const [data, setData] = useState<PayoutOrderData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<PayoutOrderData>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [fontBase64, setFontBase64] = useState<string | null>(null);
  const [pdfSignedUrl, setPdfSignedUrl] = useState<string | null>(null);
  const [attachedImageUrls, setAttachedImageUrls] = useState<string[]>([]);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const { toast } = useToast();
  const { getExpenseCategories } = useSupabaseCategories();
  const expenseCategories = getExpenseCategories();

  // Load font
  useEffect(() => {
    loadFontAsBase64('/fonts/Roboto-Regular.ttf')
      .then(setFontBase64)
      .catch(console.error);
  }, []);

  // Fetch transaction data
  useEffect(() => {
    if (!open || !transactionId) return;
    setIsLoading(true);
    setIsEditing(false);
    setHasSignature(false);
    setPdfSignedUrl(null);
    setAttachedImageUrls([]);
    setSignatureUrl(null);

    supabase
      .from('transactions')
      .select('id, date, amount, currency, issued_to, description, amount_in_words, cashier_name, decision_number')
      .eq('id', transactionId)
      .single()
      .then(({ data: tx, error }) => {
        if (error || !tx) {
          toast({ title: 'Ошибка', description: 'Не удалось загрузить данные ордера', variant: 'destructive' });
          onClose();
        } else {
          setData(tx as PayoutOrderData);
          setEditData(tx as PayoutOrderData);
        }
        setIsLoading(false);
      });
  }, [open, transactionId]);

  // Load signed URLs for PDF, signature and attached images from Storage
  useEffect(() => {
    if (!open || !pdfPath) return;

    // Extract folder: owner_user_id/transactionId
    const parts = pdfPath.split('/');
    const folderPath = parts.slice(0, 2).join('/'); // e.g. "user_id/tx_id"

    setIsLoadingFiles(true);

    // Load PDF signed URL
    supabase.storage
      .from('documents')
      .createSignedUrl(pdfPath, 60 * 60 * 24 * 7)
      .then(({ data: urlData }) => {
        setPdfSignedUrl(urlData?.signedUrl || null);
      })
      .catch(console.error);

    // List all files in the transaction folder
    supabase.storage
      .from('documents')
      .list(folderPath)
      .then(async ({ data: files }) => {
        if (!files) { setIsLoadingFiles(false); return; }

        // Filter images and signature
        const imageFiles = files.filter(f => /^image_\d+\.(jpg|jpeg|png)$/i.test(f.name));
        const sigFile = files.find(f => f.name === 'signature.png');

        // Get signed URLs for images
        const imgUrls: string[] = [];
        for (const imgFile of imageFiles) {
          const { data } = await supabase.storage
            .from('documents')
            .createSignedUrl(`${folderPath}/${imgFile.name}`, 60 * 60 * 24 * 7);
          if (data?.signedUrl) imgUrls.push(data.signedUrl);
        }
        setAttachedImageUrls(imgUrls);

        // Get signed URL for signature
        if (sigFile) {
          const { data } = await supabase.storage
            .from('documents')
            .createSignedUrl(`${folderPath}/signature.png`, 60 * 60 * 24 * 7);
          if (data?.signedUrl) setSignatureUrl(data.signedUrl);
        }

        setIsLoadingFiles(false);
      })
      .catch(() => setIsLoadingFiles(false));
  }, [open, pdfPath]);

  // Signature drawing
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
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

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
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

  const stopDrawing = () => setIsDrawing(false);

  const clearSignature = () => {
    const canvas = signatureCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const generatePDF = useCallback(async (orderData: Partial<PayoutOrderData>) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    if (fontBase64) {
      doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.setFont('Roboto');
    }

    const leftMargin = 20;
    const tableWidth = pageWidth - 40;
    const labelColWidth = 50;
    const valueColWidth = tableWidth - labelColWidth;
    const rowHeight = 10;
    const cellPadding = 3;

    const drawCell = (x: number, y: number, width: number, height: number, text: string, opts?: { fill?: boolean; align?: 'left' | 'center' }) => {
      const { fill = false, align = 'left' } = opts || {};
      if (fill) {
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, width, height, 'F');
      }
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(x, y, width, height, 'S');
      doc.setFontSize(10);
      const textX = align === 'center' ? x + width / 2 : x + cellPadding;
      const textY = y + height / 2 + 3;
      const lines = doc.splitTextToSize(text, width - cellPadding * 2);
      if (align === 'center') doc.text(lines[0] || '', textX, textY, { align: 'center' });
      else doc.text(lines[0] || '', textX, textY);
    };

    doc.setFontSize(11);
    doc.text('ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.setFont('Roboto', 'normal');
    doc.text('Dowód wypłaty', pageWidth / 2, 32, { align: 'center' });

    let yPos = 45;

    const smallTableWidth = (tableWidth - 10) / 2;
    const smallLabelWidth = 35;
    const smallValueWidth = smallTableWidth - smallLabelWidth;

    const dateStr = orderData.date ? format(new Date(orderData.date), 'yyyy-MM-dd') : '';
    drawCell(leftMargin, yPos, smallLabelWidth, rowHeight, 'Data', { fill: true });
    drawCell(leftMargin + smallLabelWidth, yPos, smallValueWidth, rowHeight, dateStr);

    const amountTableX = leftMargin + smallTableWidth + 10;
    drawCell(amountTableX, yPos, smallLabelWidth + 10, rowHeight, `Kwota (${orderData.currency || ''})`, { fill: true });
    drawCell(amountTableX + smallLabelWidth + 10, yPos, smallValueWidth - 10, rowHeight, `${orderData.amount || ''}`);

    yPos += rowHeight + 8;

    const drawRow = (label: string, value: string) => {
      drawCell(leftMargin, yPos, labelColWidth, rowHeight, label, { fill: true });
      drawCell(leftMargin + labelColWidth, yPos, valueColWidth, rowHeight, value);
      yPos += rowHeight;
    };

    drawRow('Wydano (imię nazwisko)', orderData.issued_to || '');
    drawRow('Konto dla przelewu', orderData.decision_number || '');
    drawRow('Nazwa działu', orderData.cashier_name || '');

    // Basis
    const basisText = orderData.description || '';
    const basisLines = doc.splitTextToSize(basisText, valueColWidth - cellPadding * 2);
    const basisHeight = Math.max(rowHeight * 2, basisLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, basisHeight, 'Na podstawie', { fill: true });
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, basisHeight, 'S');
    doc.setFontSize(10);
    doc.text(basisLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    yPos += basisHeight;

    // Amount in words
    const wordsText = orderData.amount_in_words || '';
    const wordsLines = doc.splitTextToSize(wordsText, valueColWidth - cellPadding * 2);
    const wordsHeight = Math.max(rowHeight * 2, wordsLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, wordsHeight, 'Kwota słownie', { fill: true });
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, wordsHeight, 'S');
    doc.setFontSize(10);
    doc.text(wordsLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    yPos += wordsHeight + 15;

    doc.setFontSize(10);
    doc.text('Kasjer: ________________________________', leftMargin, yPos);
    doc.text('Podpis kasjera: ________________________________', pageWidth / 2, yPos);
    yPos += 15;

    doc.setFontSize(11);
    doc.text('Podpis odbiorcy', leftMargin, yPos);
    yPos += 5;

    const signatureBoxWidth = 150;
    const signatureBoxHeight = 40;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPos, signatureBoxWidth, signatureBoxHeight, 'S');

    if (hasSignature && signatureCanvasRef.current) {
      const signatureData = signatureCanvasRef.current.toDataURL('image/png');
      doc.addImage(signatureData, 'PNG', leftMargin + 5, yPos + 2, signatureBoxWidth - 10, signatureBoxHeight - 4);
    }

    const issuedTo = (orderData.issued_to || 'dokument').replace(/\s/g, '_');
    const dateForFile = orderData.date ? format(new Date(orderData.date), 'yyyy-MM-dd') : 'date';
    const fileName = `dowod_wyplaty_${dateForFile}_${issuedTo}.pdf`;

    return { blob: doc.output('blob'), fileName };
  }, [fontBase64, hasSignature]);

  const handleDownload = async () => {
    if (!editData) return;
    setIsDownloading(true);
    try {
      const result = await generatePDF(editData);
      downloadPdfBlob(result.blob, result.fileName);
    } catch (e) {
      toast({ title: 'Ошибка', description: 'Не удалось создать PDF', variant: 'destructive' });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSave = async () => {
    if (!data?.id) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({
          issued_to: editData.issued_to || null,
          description: editData.description || null,
          amount_in_words: editData.amount_in_words || null,
          cashier_name: editData.cashier_name || null,
          decision_number: editData.decision_number || null,
          amount: editData.amount || data.amount,
          currency: editData.currency || data.currency,
          date: editData.date || data.date,
        })
        .eq('id', data.id);

      if (error) throw error;

      setData({ ...data, ...editData } as PayoutOrderData);
      setIsEditing(false);
      toast({ title: 'Сохранено', description: 'Данные ордера обновлены' });
    } catch (e) {
      toast({ title: 'Ошибка', description: 'Не удалось сохранить изменения', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  const displayData = isEditing ? editData : data;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setIsEditing(false); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { onClose(); onBack(); }}
                className="gap-1 text-muted-foreground hover:text-foreground -ml-2"
              >
                <ArrowLeft className="h-4 w-4" />
                {backLabel || 'Назад'}
              </Button>
            )}
            <DialogTitle className="flex items-center gap-2 text-primary">
              Расходный ордер
            </DialogTitle>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data ? (
          <div className="space-y-5">
            {/* Header info */}
            <div className="text-center border-b border-border pb-4">
              <p className="text-xs text-muted-foreground">ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE</p>
              <p className="font-bold text-lg text-foreground mt-1">Dowód wypłaty</p>
            </div>

            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-4">
              {/* Date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Data</Label>
                {isEditing ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="w-full justify-start text-left font-normal">
                        <Calendar className="mr-2 h-3 w-3" />
                        {editData.date ? format(new Date(editData.date), 'dd.MM.yyyy') : '—'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0">
                      <CalendarComponent
                        mode="single"
                        selected={editData.date ? new Date(editData.date) : undefined}
                        onSelect={(d) => d && setEditData(prev => ({ ...prev, date: format(d, 'yyyy-MM-dd') }))}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                ) : (
                  <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2">
                    {data.date ? format(new Date(data.date), 'dd.MM.yyyy') : '—'}
                  </p>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Kwota</Label>
                {isEditing ? (
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={editData.amount || ''}
                      onChange={(e) => setEditData(prev => ({ ...prev, amount: parseFloat(e.target.value) }))}
                      className="flex-1 h-9 text-sm"
                    />
                    <Input
                      value={editData.currency || ''}
                      onChange={(e) => setEditData(prev => ({ ...prev, currency: e.target.value }))}
                      className="w-16 h-9 text-sm"
                    />
                  </div>
                ) : (
                  <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2">
                    {data.amount} {data.currency}
                  </p>
                )}
              </div>
            </div>

            {/* Issued to */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Wydano (imię i nazwisko)</Label>
              {isEditing ? (
                <Input
                  value={editData.issued_to || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, issued_to: e.target.value }))}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2">
                  {data.issued_to || '—'}
                </p>
              )}
            </div>

            {/* Bank account (decision_number field) */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Konto dla przelewu</Label>
              {isEditing ? (
                <Input
                  value={editData.decision_number || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, decision_number: e.target.value }))}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2 min-h-[36px]">
                  {data.decision_number || '—'}
                </p>
              )}
            </div>

            {/* Department (cashier_name field) — Select with categories in edit mode */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nazwa działu</Label>
              {isEditing ? (
                expenseCategories.length > 0 ? (
                  <Select
                    value={editData.cashier_name || ''}
                    onValueChange={(v) => setEditData(prev => ({ ...prev, cashier_name: v }))}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue placeholder="Выберите отдел..." />
                    </SelectTrigger>
                    <SelectContent>
                      {expenseCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.name}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={editData.cashier_name || ''}
                    onChange={(e) => setEditData(prev => ({ ...prev, cashier_name: e.target.value }))}
                    className="text-sm"
                    placeholder="Название отдела..."
                  />
                )
              ) : (
                <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2 min-h-[36px]">
                  {data.cashier_name || '—'}
                </p>
              )}
            </div>

            {/* Basis */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Na podstawie (основание)</Label>
              {isEditing ? (
                <Textarea
                  value={editData.description || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2 min-h-[60px] whitespace-pre-wrap">
                  {data.description || '—'}
                </p>
              )}
            </div>

            {/* Amount in words */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Kwota słownie (сумма прописью)</Label>
              {isEditing ? (
                <Textarea
                  value={editData.amount_in_words || ''}
                  onChange={(e) => setEditData(prev => ({ ...prev, amount_in_words: e.target.value }))}
                  rows={2}
                  className="text-sm"
                />
              ) : (
                <p className="text-sm font-medium text-foreground bg-muted/40 rounded-md px-3 py-2 min-h-[60px] whitespace-pre-wrap">
                  {data.amount_in_words || '—'}
                </p>
              )}
            </div>

            {/* Signature pad */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Podpis odbiorcy (подпись для PDF)</Label>
                <Button type="button" variant="ghost" size="sm" onClick={clearSignature} className="text-muted-foreground h-7 text-xs">
                  <Eraser className="w-3 h-3 mr-1" />
                  Очистить
                </Button>
              </div>
              <div className="border-2 border-dashed border-border rounded-lg bg-white">
                <canvas
                  ref={signatureCanvasRef}
                  width={600}
                  height={120}
                  className="w-full h-24 cursor-crosshair touch-none rounded-lg"
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
              <p className="text-xs text-muted-foreground">Нарисуйте подпись для включения в PDF (необязательно)</p>
            </div>

            {/* Attached files section: PDF, images, signature */}
            {pdfPath && (
              <div className="space-y-3 pt-2 border-t border-border">
                <Label className="text-xs text-muted-foreground font-semibold">Прикреплённые файлы</Label>

                {isLoadingFiles ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Загрузка файлов...
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Attached PDF */}
                    {pdfSignedUrl && (
                      <a
                        href={pdfSignedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline bg-primary/5 border border-primary/20 rounded-md px-3 py-2"
                      >
                        <Download className="h-4 w-4" />
                        Скачать PDF ордера
                      </a>
                    )}

                    {/* Signature from Storage */}
                    {signatureUrl && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Подпись получателя</p>
                        <div className="border border-border rounded-md bg-white p-2 inline-block">
                          <img
                            src={signatureUrl}
                            alt="Подпись"
                            className="max-h-20 max-w-xs object-contain"
                          />
                        </div>
                      </div>
                    )}

                    {/* Attached images from Storage */}
                    {attachedImageUrls.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">
                          Прикреплённые фото ({attachedImageUrls.length})
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {attachedImageUrls.map((url, idx) => (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-md overflow-hidden border border-border hover:opacity-80 transition-opacity"
                            >
                              <img
                                src={url}
                                alt={`Фото ${idx + 1}`}
                                className="w-full h-32 object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {!pdfSignedUrl && !signatureUrl && attachedImageUrls.length === 0 && (
                      <p className="text-sm text-muted-foreground">Файлы недоступны</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3 pt-2 border-t border-border">
              {isEditing ? (
                <>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 gap-2"
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Сохранить изменения
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setIsEditing(false); setEditData(data); }}
                    className="gap-2"
                  >
                    <X className="h-4 w-4" />
                    Отмена
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setIsEditing(true)}
                    className="gap-2"
                  >
                    <Edit2 className="h-4 w-4" />
                    Редактировать
                  </Button>
                  <Button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="flex-1 gap-2"
                  >
                    {isDownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Скачать PDF
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
