import { useState, useRef } from 'react';
import {
  Building2, Upload, RefreshCw, CheckCircle2, AlertCircle, Link2,
  FileText, Trash2, ArrowDownCircle, Settings, ExternalLink, Info,
  ChevronDown, ChevronUp, Eye, EyeOff, Loader2,
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

  // ── Enable Banking API state ──────────────────────────────────────────────
  const [appId, setAppId] = useState(() => localStorage.getItem('eb_app_id') || '');
  const [showAppId, setShowAppId] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; iban: string; name: string }>>([]);
  const [isSyncingApi, setIsSyncingApi] = useState(false);
  const [apiInfoOpen, setApiInfoOpen] = useState(false);

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

  // ─── Enable Banking API ────────────────────────────────────────────────────

  const handleSaveAppId = () => {
    localStorage.setItem('eb_app_id', appId.trim());
    toast({ title: 'Application ID сохранён' });
  };

  const handleConnectBank = async () => {
    if (!appId.trim()) {
      toast({ title: 'Укажите Application ID', variant: 'destructive' });
      return;
    }
    setConnectionStatus('connecting');

    try {
      // Build Enable Banking authorization URL for PKO BP
      // Real flow: POST /auth to get session_id, then redirect
      const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/bank-callback`;
      const authUrl = `https://ob.enablebanking.com/auth?` +
        `app_id=${encodeURIComponent(appId.trim())}` +
        `&aspsp_name=PKO%20BP` +
        `&aspsp_country=PL` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(user?.id || '')}`;

      window.open(authUrl, '_blank');
      setConnectionStatus('idle');
      toast({
        title: 'Откроется страница PKO BP',
        description: 'После авторизации вернитесь сюда и нажмите "Синхронизировать"',
      });
    } catch {
      setConnectionStatus('error');
    }
  };

  const handleApiSync = async () => {
    toast({
      title: 'Enable Banking API',
      description: 'После регистрации и получения Application ID кнопка заработает',
    });
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-fade-in space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-primary" />
        <h3 className="text-lg font-semibold text-foreground">Банк PKO BP</h3>
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
          Вариант A — API (Enable Banking)
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

      {/* ── SECTION A: Enable Banking API ─────────────────────────────────── */}
      {activeSection === 'api' && (
        <div className="space-y-6">
          {/* Info banner */}
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 space-y-2">
            <p className="font-semibold text-sm text-yellow-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Требуется регистрация в Enable Banking
            </p>
            <p className="text-sm text-muted-foreground">
              Enable Banking — бесплатный агрегатор PSD2 API с поддержкой PKO BP.
              Не требует лицензии AISP — они уже имеют её.
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
                  <a href="https://enablebanking.com/get-started" target="_blank" rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-0.5">
                    enablebanking.com <ExternalLink className="h-3 w-3" />
                  </a>
                </li>
                <li>Создайте новое приложение в Dashboard</li>
                <li>Скопируйте <strong>Application ID</strong> и вставьте ниже</li>
                <li>Добавьте Redirect URI: <code className="bg-muted px-1 rounded text-xs">{window.location.origin}{import.meta.env.BASE_URL?.replace(/\/$/, '')}/bank-callback</code></li>
                <li>Нажмите «Подключить PKO BP» — откроется страница авторизации</li>
              </ol>
            )}
          </div>

          {/* App ID setting */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Settings className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-semibold text-sm">Настройки Enable Banking</h4>
            </div>
            <div className="space-y-2">
              <Label htmlFor="app-id">Application ID</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="app-id"
                    type={showAppId ? 'text' : 'password'}
                    value={appId}
                    onChange={e => setAppId(e.target.value)}
                    placeholder="Вставьте Application ID из Enable Banking"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAppId(!showAppId)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showAppId ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button variant="outline" onClick={handleSaveAppId}>
                  Сохранить
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                ID хранится в localStorage этого браузера
              </p>
            </div>
          </div>

          {/* Connect & status */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              PKO BP — Powszechna Kasa Oszczędności
            </h4>

            <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
              <div className={cn(
                'w-3 h-3 rounded-full flex-shrink-0',
                connectionStatus === 'connected' ? 'bg-green-500' :
                connectionStatus === 'error' ? 'bg-destructive' :
                connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                'bg-muted-foreground'
              )} />
              <span className="text-sm">
                {connectionStatus === 'connected' ? 'Подключено' :
                 connectionStatus === 'error' ? 'Ошибка подключения' :
                 connectionStatus === 'connecting' ? 'Подключение...' :
                 'Не подключено'}
              </span>
            </div>

            {bankAccounts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Счета
                </p>
                {bankAccounts.map(acc => (
                  <div key={acc.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{acc.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{acc.iban}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">PKO BP</Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleConnectBank}
                disabled={!appId.trim() || connectionStatus === 'connecting'}
                className="flex-1"
              >
                {connectionStatus === 'connecting' ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Подключить PKO BP
              </Button>
              {connectionStatus === 'connected' && (
                <Button
                  variant="outline"
                  onClick={handleApiSync}
                  disabled={isSyncingApi}
                >
                  {isSyncingApi
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <RefreshCw className="h-4 w-4" />}
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              После нажатия кнопки откроется страница PKO BP для авторизации.
              Транзакции за последние 90 дней будут добавлены автоматически.
            </p>
          </div>

          {/* Comparison note */}
          <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">💡 Рекомендация</p>
            <p>
              Если API пока недоступен — используйте <strong>Вариант B (CSV)</strong>. 
              Выписку из PKO BP можно скачать за любой период и загрузить за 10 секунд.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
