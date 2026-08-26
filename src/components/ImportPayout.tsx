import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/contexts/LanguageContext';
import { useCategories } from '@/hooks/useCategories';
import { useTransactionsWithHistory } from '@/hooks/useTransactionsWithHistory';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf';

// Ensure worker is available (cdn fallback)
GlobalWorkerOptions.workerSrc = GlobalWorkerOptions.workerSrc || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

const currencyBySymbol: Record<string, string> = {
  'zł': 'PLN',
  'PLN': 'PLN',
  '$': 'USD',
  '€': 'EUR',
  '₽': 'RUB',
  'Br': 'BYN',
  '₴': 'UAH',
};

// Simple heuristic language detection (pl/ru/en/uk)
const detectLanguage = (text: string): 'pl' | 'ru' | 'en' | 'uk' => {
  const s = text.toLowerCase();
  const scores: Record<string, number> = { pl: 0, ru: 0, en: 0, uk: 0 };
  const tokens: Record<string, string[]> = {
    pl: ['kwota', 'wydano', 'na podstawie', 'zł', 'wydat'],
    ru: ['сумма', 'выдано', 'на основании', '₽', 'расход'],
    en: ['amount', 'issued to', 'basis', 'purpose', '$', 'expense'],
    uk: ['сума', 'видано', 'підстава', '₴', 'витрат'],
  };
  for (const lang of Object.keys(tokens)) {
    for (const tkn of tokens[lang]) {
      if (s.includes(tkn)) scores[lang]++;
    }
  }
  // Pick highest score, default to 'pl' if tie/zero (since many PDFs are Polish in this app)
  const best = (Object.keys(scores) as Array<keyof typeof scores>).reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  return best as 'pl' | 'ru' | 'en' | 'uk';
};

const tryExtract = (text: string) => {
  const res: Partial<Record<'date'|'amount'|'currency'|'issuedTo'|'description', string>> = {};
  const lang = detectLanguage(text);

  // Date YYYY-MM-DD
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/)
    || text.match(/\b(\d{2}\.\d{2}\.\d{4})\b/); // accept dd.mm.yyyy too
  if (dateMatch) {
    const d = dateMatch[1];
    // convert dd.mm.yyyy to yyyy-mm-dd
    if (/\d{2}\.\d{2}\.\d{4}/.test(d)) {
      const [dd, mm, yyyy] = d.split('.');
      res.date = `${yyyy}-${mm}-${dd}`;
    } else {
      res.date = d;
    }
  }

  // Build language-aware keywords
  const amountKeywords = {
    pl: ['Kwota', 'kwota'],
    ru: ['Сумма', 'сумма'],
    en: ['Amount', 'amount'],
    uk: ['Сума', 'сума'],
  } as const;
  const issuedKeywords = {
    pl: ['Wydano', 'wydano'],
    ru: ['Выдано', 'выдано'],
    en: ['Issued to', 'issued to'],
    uk: ['Видано', 'видано', 'Виданo'],
  } as const;
  const descKeywords = {
    pl: ['Na podstawie', 'Opis', 'na podstawie', 'opis'],
    ru: ['На основании', 'Назначение', 'на основании', 'назначение'],
    en: ['Basis', 'Purpose', 'Description', 'basis', 'purpose', 'description'],
    uk: ['Підстава', 'Призначення', 'підстава', 'призначення'],
  } as const;

  // Amount with optional currency code or symbol
  const amountRegex = new RegExp(`(?:${amountKeywords[lang].join('|')})[:\\s]*([0-9]+[\\.,]?[0-9]{0,2})\\s*(PLN|USD|EUR|UAH|BYN|RUB|zł|€|\\$|₽)?`, 'i');
  const amountMatch = text.match(amountRegex)
    || text.match(/([0-9]+[\.,][0-9]{2})\s*(PLN|USD|EUR|UAH|BYN|RUB|zł|€|\$|₽)/i)
    || text.match(/([0-9]+[\.,]?[0-9]{0,2})/);
  if (amountMatch) {
    res.amount = amountMatch[1].replace(',', '.');
    const cur = amountMatch[2];
    if (cur) {
      res.currency = currencyBySymbol[cur] || cur.toUpperCase();
    }
  }

  // Issued to
  const issuedRegex = new RegExp(`(?:${issuedKeywords[lang].join('|')})[:\\s\-]*([A-ZА-ЯЁІЇЄ0-9A-Za-ząćęłńóśżźА-Яа-яёЁ\-\\s\\.\\,]{2,120})`, 'i');
  const issuedMatch = text.match(issuedRegex);
  if (issuedMatch) res.issuedTo = issuedMatch[1].trim();

  // Description
  const descRegex = new RegExp(`(?:${descKeywords[lang].join('|')})[:\\s\-]*([\\s\\S]{2,200})`, 'i');
  const descMatch = text.match(descRegex);
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

  // Preview dialog state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Partial<{ date: string; amount: string; currency: string; issuedTo: string; description: string; category: string }>|null>(null);

  const currencies = ['PLN','USD','EUR','UAH','BYN','RUB'] as const;

  const onFile = async (file: File) => {
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = getDocument({ data: arrayBuffer });
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

      const defaultCategory = getExpenseCategories()[0]?.id || 'other';

      setParsed({
        date: extracted.date || undefined,
        amount: extracted.amount || undefined,
        currency: (extracted.currency as any) || 'PLN',
        issuedTo: extracted.issuedTo || undefined,
        description: extracted.description || undefined,
        category: defaultCategory,
      });
      setFileName(file.name);
      setPreviewOpen(true);
    } catch (e) {
      console.error(e);
      toast({ title: t('importError'), description: t('importFailedParse'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  // Sanitize text to prevent injection
  const sanitizeText = (text: string | undefined): string => {
    if (!text) return '';
    return text.replace(/<[^>]*>/g, '').substring(0, 500).trim();
  };

  const confirmImport = () => {
    if (!parsed || !parsed.amount) {
      toast({ title: t('importError'), description: t('importFailedParse'), variant: 'destructive' });
      return;
    }
    
    // Validate and sanitize amount
    const amountNum = parseFloat(parsed.amount.replace(',', '.'));
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > 1000000000) {
      toast({ title: t('importError'), description: 'Invalid amount', variant: 'destructive' });
      return;
    }
    
    // Validate date
    const date = parsed.date ? new Date(parsed.date) : new Date();
    if (isNaN(date.getTime())) {
      toast({ title: t('importError'), description: 'Invalid date', variant: 'destructive' });
      return;
    }
    
    const currency = (parsed.currency as any) || 'PLN';
    const category = parsed.category || getExpenseCategories()[0]?.id || 'other';

    // Sanitize text fields
    const sanitizedDescription = sanitizeText(parsed.description) || `Imported from ${sanitizeText(fileName) || 'file'}`;
    const sanitizedIssuedTo = sanitizeText(parsed.issuedTo);

    addTransaction({
      type: 'expense',
      amount: amountNum,
      currency,
      category: category as any,
      description: sanitizedDescription,
      date,
      issuedTo: sanitizedIssuedTo || undefined,
    });

    toast({ title: t('importSuccess'), description: `${amountNum.toFixed(2)} ${currency}` });
    setPreviewOpen(false);
    setParsed(null);
    setFileName(null);
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={e => {
        const f = e.target.files?.[0]; if (f) onFile(f); e.currentTarget.value = '';
      }} />

      <Button variant="outline" className="font-semibold" onClick={() => inputRef.current?.click()} disabled={loading}>
        {loading ? 'Importing...' : t('importDocument')}
      </Button>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('importPreviewTitle')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <div>
              <label className="text-sm text-muted-foreground">{t('date')}</label>
              <Input type="date" value={parsed?.date || ''} onChange={(e) => setParsed(p => ({ ...(p||{}), date: e.target.value }))} />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">{t('amount')}</label>
              <Input value={parsed?.amount || ''} onChange={(e) => setParsed(p => ({ ...(p||{}), amount: e.target.value }))} />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">{t('currency')}</label>
              <Select value={parsed?.currency} onValueChange={(v) => setParsed(p => ({ ...(p||{}), currency: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map(c => <SelectItem value={c} key={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm text-muted-foreground">{t('issuedTo') || 'Issued to'}</label>
              <Input value={parsed?.issuedTo || ''} onChange={(e) => setParsed(p => ({ ...(p||{}), issuedTo: e.target.value }))} />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">{t('description')}</label>
              <Textarea value={parsed?.description || ''} onChange={(e) => setParsed(p => ({ ...(p||{}), description: e.target.value }))} />
            </div>

            <div>
              <label className="text-sm text-muted-foreground">{t('expenseCategories')}</label>
              <Select value={parsed?.category} onValueChange={(v) => setParsed(p => ({ ...(p||{}), category: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {getExpenseCategories().map(cat => <SelectItem value={cat.id} key={cat.id}>{cat.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => { setPreviewOpen(false); setParsed(null); setFileName(null); }}>{t('importCancel')}</Button>
            <Button onClick={confirmImport}>{t('importConfirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ImportPayout;
