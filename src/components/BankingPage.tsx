import { useState, useRef, useEffect } from 'react';
import {
  Building2, Upload, RefreshCw, CheckCircle2, AlertCircle, Link2,
  FileText, Trash2, ArrowDownCircle, Settings, ExternalLink, Info,
  ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  currency: string;
  type: 'income' | 'expense';
  rawLine: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface PolishBank {
  id: string;
  name: string;
  logo: string | null;
  bic: string | null;
}

interface BankConnection {
  bank_name: string;
  session_id: string;
  last_sync_at: string;
  accounts: Array<{ uid: string; iban: string; name: string }>;
}

// Well-known Polish banks (fallback if API list fails)
const FALLBACK_POLISH_BANKS: PolishBank[] = [
  { id: 'PKO_BPKOPLPW', name: 'PKO Bank Polski', logo: null, bic: 'BPKOPLPW' },
  { id: 'PEKAO_PKOPPLPW', name: 'Bank Pekao', logo: null, bic: 'PKOPPLPW' },
  { id: 'SANTANDER_PL_WBKPPLPP', name: 'Santander Bank Polska', logo: null, bic: 'WBKPPLPP' },
  { id: 'MBANK_RETAIL_BREXPLPW', name: 'mBank', logo: null, bic: 'BREXPLPW' },
  { id: 'ING_PL_INGBPLPW', name: 'ING Bank Śląski', logo: null, bic: 'INGBPLPW' },
  { id: 'BNP_PL_PPABPLPK', name: 'BNP Paribas', logo: null, bic: 'PPABPLPK' },
  { id: 'MILLENNIUM_BIGBPLPW', name: 'Bank Millennium', logo: null, bic: 'BIGBPLPW' },
  { id: 'ALIOR_ALBPPLPW', name: 'Alior Bank', logo: null, bic: 'ALBPPLPW' },
  { id: 'CREDIT_AGRICOLE_AGRIPLPR', name: 'Credit Agricole', logo: null, bic: 'AGRIPLPR' },
];

// ─── PKO BP CSV parser ─────────────────────────────────────────────────────────
// PKO BP exports semicolon-separated CSV with header:
// "Data operacji";"Data waluty";"Typ transakcji";"Kwota";"Waluta";"Saldo po transakcji";"Opis transakcji"
// or newer format:
// "Data";"Data waluty";"Rodzaj transakcji";"Kwota";"Waluta";"Saldo";"Opis transakcji";"Numer rachunku"

function parsePkoBpCsv(text: string): ParsedTransaction[] {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length < 2) return [];

  // Detect separator
  const sep = lines[0].includes(';') ? ';' : ',';

  // Find header line
  const headerIdx = lines.findIndex(l =>
    l.toLowerCase().includes('data') && (l.toLowerCase().includes('kwota') || l.toLowerCase().includes('amount'))
  );
  if (headerIdx === -1) return [];

  const header = splitCsvLine(lines[headerIdx], sep).map(h => h.toLowerCase().replace(/"/g, '').trim());

  // Detect column indices
  const colDate = findCol(header, ['data operacji', 'data', 'date', 'buchungstag']);
  const colAmount = findCol(header, ['kwota', 'amount', 'betrag']);
  const colCurrency = findCol(header, ['waluta', 'currency', 'währung', 'wahrung']);
  const colDesc = findCol(header, ['opis transakcji', 'opis', 'description', 'titel', 'verwendungszweck', 'tytuł']);
  const colType = findCol(header, ['typ transakcji', 'rodzaj transakcji', 'type']);

  if (colDate === -1 || colAmount === -1) return [];

  const result: ParsedTransaction[] = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.startsWith('"Saldo') || line.startsWith('Saldo')) continue;

    const cols = splitCsvLine(line, sep).map(c => c.replace(/"/g, '').trim());
    if (cols.length < 2) continue;

    const rawDate = cols[colDate] || '';
    const rawAmount = cols[colAmount] || '0';
    const currency = colCurrency !== -1 ? (cols[colCurrency] || 'PLN') : 'PLN';
    const description = colDesc !== -1 ? (cols[colDesc] || '') : cols.slice(colDesc !== -1 ? colDesc : 6).join(' ');
    const rawType = colType !== -1 ? (cols[colType] || '') : '';

    // Parse amount — PKO BP uses comma as decimal separator
    const amountStr = rawAmount.replace(/\s/g, '').replace(',', '.');
    const amount = parseFloat(amountStr);
    if (isNaN(amount)) continue;

    // Parse date (YYYY-MM-DD or DD-MM-YYYY or DD.MM.YYYY)
    const date = normalizeDate(rawDate);
    if (!date) continue;

    const type: 'income' | 'expense' = determineType(amount, rawType);

    result.push({
      date,
      description: cleanDescription(description),
      amount: Math.abs(amount),
      currency: currency.toUpperCase() || 'PLN',
      type,
      rawLine: line,
    });
  }

  return result;
}

function findCol(header: string[], candidates: string[]): number {
  for (const c of candidates) {
    const idx = header.findIndex(h => h.includes(c));
    if (idx !== -1) return idx;
  }
  return -1;
}

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function normalizeDate(raw: string): string | null {
  if (!raw) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  // DD-MM-YYYY or DD.MM.YYYY
  const m = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  // DD.MM.YY
  const m2 = raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2})$/);
  if (m2) return `20${m2[3]}-${m2[2]}-${m2[1]}`;
  return null;
}

function determineType(amount: number, typeHint: string): 'income' | 'expense' {
  if (amount > 0) return 'income';
  if (amount < 0) return 'expense';
  const hint = typeHint.toLowerCase();
  if (hint.includes('wpływ') || hint.includes('przychod') || hint.includes('uznanie') || hint.includes('credit')) return 'income';
  return 'expense';
}

function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+/g, ' ')
    .replace(/^Tytuł:\s*/i, '')
    .replace(/^Title:\s*/i, '')
    .trim()
    .slice(0, 200);
}

// ─── Main Component ────────────────────────────────────────────────────────────

export const BankingPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tabs: 'import' | 'api'
  const [activeSection, setActiveSection] = useState<'import' | 'api'>('import');

  // ── CSV Import state ─────────────────────────────────────────────────────
  const [parsedRows, setParsedRows] = useState<ParsedTransaction[]>([]);
  const [fileName, setFileName] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // ── GoCardless API state ───────────────────────────────────────────────
  const [connectingBank, setConnectingBank] = useState<string | null>(null);
  const [bankConnections, setBankConnections] = useState<BankConnection[]>([]);
  const [syncingBank, setSyncingBank] = useState<string | null>(null);
  const [apiInfoOpen, setApiInfoOpen] = useState(false);
  const [availableBanks, setAvailableBanks] = useState<PolishBank[]>(FALLBACK_POLISH_BANKS);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [bankSearch, setBankSearch] = useState('');

  // Load saved connections on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from('bank_connections')
      .select('bank_name, session_id, last_sync_at, accounts')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (error) console.error('[BankingPage] load connections:', error);
        if (data && data.length > 0) {
          setBankConnections(data.map(d => ({
            bank_name: d.bank_name,
            session_id: d.session_id,
            last_sync_at: d.last_sync_at,
            accounts: (d.accounts as any[]) || [],
          })));
        }
      });
  }, [user]);

  // Fetch available banks from GoCardless
  useEffect(() => {
    if (!user) return;
    fetchAvailableBanks();
  }, [user]);

  const fetchAvailableBanks = async () => {
    setLoadingBanks(true);
    try {
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/banking-auth-start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ list_banks: true }),
      });
      const json = await res.json();
      if (json.banks && json.banks.length > 0) {
        setAvailableBanks(json.banks);
      }
    } catch (e) {
      console.error('[BankingPage] fetch banks:', e);
    } finally {
      setLoadingBanks(false);
    }
  };

  // ─── CSV Upload & Parse ────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsParsing(true);
    setImportResult(null);
    setParsedRows([]);

    try {
      const text = await file.text();
      const rows = parsePkoBpCsv(text);
      if (rows.length === 0) {
        toast({
          title: 'Не удалось распознать файл',
          description: 'Убедитесь, что файл — это выписка PKO BP в формате CSV',
          variant: 'destructive',
        });
      } else {
        setParsedRows(rows);
        setSelectedRows(new Set(rows.map((_, i) => i)));
        toast({
          title: `Загружено ${rows.length} транзакций`,
          description: `Из файла: ${file.name}`,
        });
      }
    } catch (err) {
      toast({ title: 'Ошибка чтения файла', variant: 'destructive' });
    } finally {
      setIsParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleRow = (idx: number) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === parsedRows.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(parsedRows.map((_, i) => i)));
  };

  const handleImport = async () => {
    if (!user || selectedRows.size === 0) return;
    setIsImporting(true);

    const toImport = parsedRows.filter((_, i) => selectedRows.has(i));
    let imported = 0;
    const errors: string[] = [];

    // Get categories for mapping
    const { data: cats } = await supabase
      .from('categories')
      .select('id, name, type')
      .eq('user_id', user.id);

    const incomeDefaultId = cats?.find(c => c.type === 'income')?.id || null;
    const expenseDefaultId = cats?.find(c => c.type === 'expense')?.id || null;

    for (const row of toImport) {
      try {
        const { error } = await supabase.from('transactions').insert({
          user_id: user.id,
          type: row.type,
          amount: row.amount,
          currency: row.currency as any,
          date: row.date,
          description: row.description || 'Импорт PKO BP',
          category_id: row.type === 'income' ? incomeDefaultId : expenseDefaultId,
        });
        if (error) {
          errors.push(`${row.date}: ${error.message}`);
        } else {
          imported++;
        }
      } catch (e: any) {
        errors.push(`${row.date}: ${e.message}`);
      }
    }

    setImportResult({ imported, skipped: toImport.length - imported - errors.length, errors });
    setIsImporting(false);

    toast({
      title: `Импортировано ${imported} транзакций`,
      description: errors.length > 0 ? `${errors.length} ошибок` : 'Готово',
      variant: errors.length > 0 ? 'destructive' : 'default',
    });

    if (imported > 0) {
      setParsedRows([]);
      setFileName('');
    }
  };

  // ─── GoCardless Bank Account Data API ─────────────────────────────────────

  const handleConnectBank = async (bankName: string, institutionId: string) => {
    setConnectingBank(bankName);

    try {
      const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/#/bank-callback`;

      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const statePayload = JSON.stringify({
        user_id: user?.id || crypto.randomUUID(),
        bank_name: bankName,
      });

      const res = await fetch(`${supabaseUrl}/functions/v1/banking-auth-start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          redirect_uri: redirectUri,
          state: statePayload,
          institution_id: institutionId,
        }),
      });

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      console.log('[BankingPage] auth-start response:', json);

      if (!res.ok) {
        const msg = json?.error || json?.message || `HTTP ${res.status}`;
        setConnectingBank(null);
        toast({ title: 'Ошибка подключения', description: msg, variant: 'destructive' });
        return;
      }

      if (!json?.url) {
        setConnectingBank(null);
        toast({ title: 'Ошибка', description: 'GoCardless не вернул URL', variant: 'destructive' });
        return;
      }

      // Save requisition_id to localStorage so BankCallback can use it
      if (json.requisition_id) {
        localStorage.setItem('gc_requisition_id', json.requisition_id);
      }

      window.location.href = json.url;
    } catch (e) {
      setConnectingBank(null);
      toast({ title: 'Ошибка', description: String(e), variant: 'destructive' });
    }
  };

  const handleApiSync = async (bankName?: string) => {
    if (!user) return;
    setSyncingBank(bankName || '__all__');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const accessToken = session?.access_token || supabaseKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/banking-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ user_id: user.id, bank_name: bankName }),
      });

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));

      if (!res.ok) {
        toast({ title: 'Ошибка синхронизации', description: json?.error || `HTTP ${res.status}`, variant: 'destructive' });
        return;
      }

      // Reload connections
      const { data } = await supabase
        .from('bank_connections')
        .select('bank_name, session_id, last_sync_at, accounts')
        .eq('user_id', user.id);
      if (data) {
        setBankConnections(data.map(d => ({
          bank_name: d.bank_name,
          session_id: d.session_id,
          last_sync_at: d.last_sync_at,
          accounts: (d.accounts as any[]) || [],
        })));
      }

      toast({
        title: 'Синхронизация завершена',
        description: json.imported > 0
          ? `Добавлено ${json.imported} новых транзакций`
          : json.debug?.some((d: any) => d.error) 
            ? 'Нет счетов — попробуйте переподключить банк'
            : 'Новых транзакций нет',
      });
    } catch (e) {
      toast({ title: 'Ошибка синхронизации', description: String(e), variant: 'destructive' });
    } finally {
      setSyncingBank(null);
    }
  };

  const handleDisconnectBank = async (bankName: string) => {
    if (!user) return;
    const { error } = await supabase
      .from('bank_connections')
      .delete()
      .eq('user_id', user.id)
      .eq('bank_name', bankName);
    if (error) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
      return;
    }
    setBankConnections(prev => prev.filter(c => c.bank_name !== bankName));
    toast({ title: 'Банк отключён', description: bankName });
  };

  const connectedBankNames = new Set(bankConnections.map(c => c.bank_name));

  const filteredBanks = availableBanks.filter(b =>
    b.name.toLowerCase().includes(bankSearch.toLowerCase())
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Банки Польши</h3>
        {bankConnections.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {bankConnections.length} подключ.
          </Badge>
        )}
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveSection('import')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
            activeSection === 'import'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Upload className="h-4 w-4" />
          Вариант B — Импорт CSV
        </button>
        <button
          onClick={() => setActiveSection('api')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2',
            activeSection === 'api'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
        >
          <Link2 className="h-4 w-4" />
          Вариант A — API (GoCardless)
        </button>
      </div>

      {/* ── SECTION B: CSV Import ──────────────────────────────────────────── */}
      {activeSection === 'import' && (
        <div className="space-y-6">
          {/* Instructions */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 space-y-2">
            <p className="font-semibold text-sm text-blue-400 flex items-center gap-2">
              <Info className="h-4 w-4" />
              Как скачать выписку из PKO BP
            </p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Войдите в <strong>iPKO</strong> (ipko.pl) или приложение PKO BP</li>
              <li>Перейдите в раздел <strong>«Mój rachunek» → «Historia»</strong></li>
              <li>Выберите период и нажмите <strong>«Eksportuj» → «CSV»</strong></li>
              <li>Загрузите скачанный файл ниже</li>
            </ol>
            <a
              href="https://www.ipko.pl"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 underline"
            >
              Открыть iPKO <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {/* Upload area */}
          <div
            className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.mt940,.sta"
              className="hidden"
              onChange={handleFileChange}
            />
            {isParsing ? (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-muted-foreground text-sm">Обработка файла...</p>
              </div>
            ) : fileName ? (
              <div className="flex flex-col items-center gap-2">
                <FileText className="h-8 w-8 text-primary" />
                <p className="font-medium text-sm">{fileName}</p>
                <p className="text-muted-foreground text-xs">Нажмите для замены файла</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-sm">Нажмите или перетащите файл CSV</p>
                <p className="text-muted-foreground text-xs">Поддерживается формат PKO BP CSV</p>
              </div>
            )}
          </div>

          {/* Import result */}
          {importResult && (
            <div className={cn(
              'rounded-xl border p-4 flex items-start gap-3',
              importResult.errors.length > 0
                ? 'bg-destructive/10 border-destructive/20'
                : 'bg-green-500/10 border-green-500/20'
            )}>
              {importResult.errors.length > 0
                ? <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                : <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />}
              <div>
                <p className="font-medium text-sm">
                  Импортировано: {importResult.imported} транзакций
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {importResult.errors.slice(0, 5).map((e, i) => (
                      <li key={i} className="text-xs text-muted-foreground">{e}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Parsed preview */}
          {parsedRows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {showPreview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    Предпросмотр ({parsedRows.length} строк)
                  </button>
                  <Badge variant="outline" className="text-xs">
                    Выбрано: {selectedRows.size}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={toggleAll} className="text-xs h-7">
                    {selectedRows.size === parsedRows.length ? 'Снять всё' : 'Выбрать всё'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setParsedRows([]); setFileName(''); }}
                    className="text-xs h-7 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Очистить
                  </Button>
                </div>
              </div>

              {showPreview && (
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="overflow-x-auto max-h-80 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left w-6">
                            <input
                              type="checkbox"
                              checked={selectedRows.size === parsedRows.length}
                              onChange={toggleAll}
                              className="rounded"
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-medium">Дата</th>
                          <th className="px-3 py-2 text-left text-muted-foreground font-medium">Описание</th>
                          <th className="px-3 py-2 text-right text-muted-foreground font-medium">Сумма</th>
                          <th className="px-3 py-2 text-center text-muted-foreground font-medium">Тип</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row, i) => (
                          <tr
                            key={i}
                            onClick={() => toggleRow(i)}
                            className={cn(
                              'border-t border-border cursor-pointer transition-colors',
                              selectedRows.has(i) ? 'bg-primary/5' : 'hover:bg-muted/50 opacity-50'
                            )}
                          >
                            <td className="px-3 py-2 align-top">
                              <input
                                type="checkbox"
                                checked={selectedRows.has(i)}
                                onChange={() => toggleRow(i)}
                                onClick={e => e.stopPropagation()}
                                className="rounded"
                              />
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-muted-foreground align-top">
                              {row.date}
                            </td>
                            <td className="px-3 py-2 text-foreground align-top max-w-[200px] truncate">
                              {row.description || '—'}
                            </td>
                            <td className={cn(
                              'px-3 py-2 text-right whitespace-nowrap font-medium align-top',
                              row.type === 'income' ? 'text-green-500' : 'text-red-400'
                            )}>
                              {row.type === 'income' ? '+' : '-'}{row.amount.toFixed(2)} {row.currency}
                            </td>
                            <td className="px-3 py-2 text-center align-top">
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[10px] px-1.5 py-0',
                                  row.type === 'income'
                                    ? 'border-green-500/40 text-green-500'
                                    : 'border-red-400/40 text-red-400'
                                )}
                              >
                                {row.type === 'income' ? 'Доход' : 'Расход'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Import button */}
              <Button
                onClick={handleImport}
                disabled={isImporting || selectedRows.size === 0}
                className="w-full"
                size="lg"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Импортирование...
                  </>
                ) : (
                  <>
                    <ArrowDownCircle className="h-4 w-4 mr-2" />
                    Импортировать {selectedRows.size} транзакций в приложение
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── SECTION A: GoCardless Bank Account Data API ────────────────── */}
      {activeSection === 'api' && (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 space-y-2">
            <p className="font-semibold text-sm text-yellow-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              GoCardless Bank Account Data (бесплатно)
            </p>
            <p className="text-sm text-muted-foreground">
              GoCardless — бесплатный PSD2 агрегатор для доступа к банковским счетам.
              Поддерживает все основные польские банки без ограничений.
            </p>
            <button
              onClick={() => setApiInfoOpen(!apiInfoOpen)}
              className="text-xs text-yellow-400 flex items-center gap-1 hover:text-yellow-300"
            >
              {apiInfoOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              Инструкция по регистрации
            </button>
            {apiInfoOpen && (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside mt-2">
                <li>
                  Зарегистрируйтесь на{' '}
                  <a href="https://bankaccountdata.gocardless.com/signup" target="_blank" rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-0.5">
                    bankaccountdata.gocardless.com <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Перейдите в <strong>User secrets</strong> и создайте новый ключ</li>
                <li>Скопируйте <strong>secret_id</strong> и <strong>secret_key</strong></li>
                <li>Добавьте оба секрета в Supabase Edge Functions Secrets</li>
                <li>Нажмите «Подключить» на любом банке — откроется страница авторизации</li>
              </ol>
            )}
          </div>

          {/* Setup instructions */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-semibold text-sm">Настройка GoCardless</h4>
            </div>
            <p className="text-xs text-muted-foreground">
              Для подключения банков добавьте два секрета в{' '}
              <a
                href="https://supabase.com/dashboard/project/htepbcotdqrewbxmasbf/settings/vault"
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-primary"
              >
                Supabase Vault → Secrets
              </a>
              :
            </p>
            <div className="bg-muted/50 rounded-lg p-3 font-mono text-xs space-y-1 leading-relaxed">
              <p><span className="text-yellow-500">GC_SECRET_ID</span> = ваш secret_id из <a href="https://bankaccountdata.gocardless.com/user-secrets/" target="_blank" rel="noopener noreferrer" className="underline text-primary">GoCardless User Secrets</a></p>
              <p><span className="text-yellow-500">GC_SECRET_KEY</span> = ваш secret_key</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Если ещё нет аккаунта:{' '}
              <a href="https://bankaccountdata.gocardless.com/signup" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                зарегистрируйтесь
              </a>
              , создайте User secret — и скопируйте оба значения.
            </p>
          </div>

          {/* Connected banks */}
          {bankConnections.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Подключённые банки ({bankConnections.length})
                </h4>
                {bankConnections.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleApiSync()}
                    disabled={syncingBank !== null}
                    className="text-xs h-7"
                  >
                    {syncingBank === '__all__'
                      ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      : <RefreshCw className="h-3 w-3 mr-1" />}
                    Синхр. все
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                {bankConnections.map(conn => (
                  <div key={conn.bank_name} className="bg-muted/30 border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
                        <span className="font-medium text-sm">{conn.bank_name}</span>
                        <Badge variant="outline" className="text-[10px]">Подключено</Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleApiSync(conn.bank_name)}
                          disabled={syncingBank !== null}
                          title="Синхронизировать"
                          className="h-7 w-7 p-0"
                        >
                          {syncingBank === conn.bank_name
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const bank = availableBanks.find(b => b.name === conn.bank_name);
                            handleConnectBank(conn.bank_name, bank?.id || '');
                          }}
                          disabled={connectingBank !== null}
                          title="Переподключить"
                          className="h-7 w-7 p-0"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDisconnectBank(conn.bank_name)}
                          title="Отключить"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {conn.last_sync_at && (
                      <p className="text-xs text-muted-foreground">
                        Последняя синхронизация: {new Date(conn.last_sync_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                    {conn.accounts.length > 0 && (
                      <div className="space-y-1">
                        {conn.accounts.map(acc => (
                          <div key={acc.uid} className="flex items-center justify-between text-xs px-2 py-1 bg-muted/50 rounded">
                            <span className="font-mono text-muted-foreground">{acc.iban || acc.uid}</span>
                            <Badge variant="outline" className="text-[10px]">{conn.bank_name}</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available banks to connect */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                Доступные банки Польши
              </h4>
              {loadingBanks && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>

            <Input
              placeholder="Поиск банка..."
              value={bankSearch}
              onChange={(e) => setBankSearch(e.target.value)}
              className="h-8 text-sm"
            />

            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {filteredBanks.map(bank => {
                const isConnected = connectedBankNames.has(bank.name);
                const isConnecting = connectingBank === bank.name;
                return (
                  <div
                    key={bank.name}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border transition-colors',
                      isConnected
                        ? 'bg-green-500/5 border-green-500/20'
                        : 'bg-muted/30 border-border hover:border-primary/30'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {bank.logo ? (
                        <img
                          src={bank.logo}
                          alt={bank.name}
                          className="w-8 h-8 rounded object-contain bg-white p-0.5"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{bank.name}</p>
                        {bank.bic && (
                          <p className="text-[10px] text-muted-foreground font-mono">{bank.bic}</p>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={isConnected ? 'outline' : 'default'}
                      onClick={() => handleConnectBank(bank.name, bank.id)}
                      disabled={connectingBank !== null}
                      className="text-xs h-7 flex-shrink-0"
                    >
                      {isConnecting ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Link2 className="h-3 w-3 mr-1" />
                      )}
                      {isConnected ? 'Переподключить' : 'Подключить'}
                    </Button>
                  </div>
                );
              })}
              {filteredBanks.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  {bankSearch ? 'Банк не найден' : 'Загрузка списка банков...'}
                </p>
              )}
            </div>
          </div>

          {/* Comparison note */}
          <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">💡 Рекомендация</p>
            <p>
              Если API пока недоступен — используйте <strong>Вариант B (CSV)</strong>. 
              Выписку из банка можно скачать за любой период и загрузить за 10 секунд.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
