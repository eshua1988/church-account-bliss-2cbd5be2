import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/contexts/LanguageContext';
import { useCategories } from '@/hooks/useCategories';
import { useTransactionsWithHistory } from '@/hooks/useTransactionsWithHistory';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';

// Ensure worker is available (cdn fallback)
(pdfjsLib as any).GlobalWorkerOptions = (pdfjsLib as any).GlobalWorkerOptions || {};
(pdfjsLib as any).GlobalWorkerOptions.workerSrc = (pdfjsLib as any).GlobalWorkerOptions.workerSrc || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const currencyBySymbol: Record<string, string> = {
  'zł': 'PLN',
  'PLN': 'PLN',
  '$': 'USD',
  '€': 'EUR',
  '₽': 'RUB',
  'Br': 'BYN',
  '₴': 'UAH',
};

const tryExtract = (text: string) => {
  const res: Partial<Record<'date'|'amount'|'currency'|'issuedTo'|'description', string>> = {};

  // Date YYYY-MM-DD
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) res.date = dateMatch[1];

  // Amount with optional currency code or symbol
  const amountMatch = text.match(/(?:Kwota|Amount)[:\s]*([0-9]+[\.,]?[0-9]{0,2})\s*(PLN|USD|EUR|UAH|BYN|RUB|zł|€|\$|₽)?/i)
    || text.match(/([0-9]+[\.,][0-9]{2})\s*(PLN|USD|EUR|UAH|BYN|RUB|zł|€|\$|₽)/i)
    || text.match(/([0-9]+[\.,]?[0-9]{0,2})/);
  if (amountMatch) {
    res.amount = amountMatch[1].replace(',', '.');
    const cur = amountMatch[2];
    if (cur) {
      res.currency = currencyBySymbol[cur] || cur.toUpperCase();
    }
  }

  // Issued to (Wydano / Issued to / Выдано)
  const issuedMatch = text.match(/(?:Wydano|Issued to|Выдано)[:\s\-]*([A-ZА-ЯЁІЇЄ0-9A-Za-ząćęłńóśżźА-Яа-яёЁ\-\s\.\,]{2,80})/i);
  if (issuedMatch) res.issuedTo = issuedMatch[1].trim();

  // Description: try to find 'Na podstawie' or 'Basis' or 'Description' context
  const descMatch = text.match(/(?:Na podstawie|Basis|Purpose|Opis)[:\s\-]*([\s\S]{2,120})/i);
  if (descMatch) res.description = descMatch[1].trim().split('\n')[0];

  return res;
};

export const ImportPayout = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();
  const { t } = useTranslation();
  const { getExpenseCategories } = useCategories();
  const { addTransaction } = useTransactionsWithHistory();
  const [loading, setLoading] = useState(false);

  const onFile = async (file: File) => {
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      const pagesToRead = Math.min(pdf.numPages, 3);
      for (let i = 1; i <= pagesToRead; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strs = content.items.map((it: any) => it.str).join(' ');
        fullText += '\n' + strs;
      }

      const extracted = tryExtract(fullText);
      if (!extracted.amount) {
        toast({ title: t('importError'), description: t('importFailedParse'), variant: 'destructive' });
        setLoading(false);
        return;
      }

      const amountNum = parseFloat(extracted.amount || '0');
      const currency = (extracted.currency as any) || 'PLN';
      const category = getExpenseCategories()[0]?.id || 'other_expense';

      addTransaction({
        type: 'expense',
        amount: amountNum,
        currency: currency as any,
        category: category as any,
        description: extracted.description || `Imported from ${file.name}`,
        date: extracted.date ? new Date(extracted.date) : new Date(),
        issuedTo: extracted.issuedTo || undefined,
      });

      toast({ title: t('importSuccess'), description: `${extracted.amount} ${currency}` });
    } catch (e) {
      console.error(e);
      toast({ title: t('importError'), description: t('importFailedParse'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={e => {
        const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '';
      }} />
      <Button variant="outline" className="font-semibold" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? 'Importing...' : t('importPayout')}
      </Button>
    </>
  );
};

export default ImportPayout;
