import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, ChevronDown, ChevronUp, TrendingUp, TrendingDown, SlidersHorizontal, X, Settings, Table2, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';
import { CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';
import DateRangeFilter from '@/components/DateRangeFilter';
import { CloudSyncIcon } from '@/components/icons/CloudSyncIcon';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Category {
  id: string;
  name: string;
  type: string;
}

interface PublicTransactionsResponse {
  valid: boolean;
  error?: string;
  categories?: Category[];
  transactions?: Transaction[];
  otherRuleSearchTerms?: {
    income?: string[];
    expense?: string[];
  };
  pendingRuleSearchTerms?: {
    income?: string[];
    expense?: string[];
  };
  success?: boolean;
  source?: { id: string };
  sheets?: string[];
  addedTerms?: string[];
  existingTerms?: string[];
  imported?: number;
  exported?: number;
  hasMore?: boolean;
  nextCursor?: { date: string; createdAt: string; id: string } | null;
  sheetsSettings?: {
    spreadsheetId: string;
    sheetName: string;
    sheetRange: string;
  };
  exportSources?: Array<{ id: string; spreadsheet_id: string; sheet_name: string; sheet_range: string; search_keyword: string }>;
  registrationSources?: Array<{ id: string; spreadsheet_id: string; sheet_name: string; sheet_range: string; name_columns: string; amount_column: string; search_keyword: string }>;
}

const DocumentKeywordIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4 3h10a2 2 0 0 1 2 2v5" />
    <path d="M4 3v16h6" />
    <path d="M7 7h6M7 10h5M7 13h3" />
    <circle cx="15" cy="15" r="5" />
    <path d="m18.7 18.7 3 3" />
    <path d="M13.2 16.6 15 12.8l1.8 3.8M13.8 15.4h2.4M18.2 13.5h2M19.2 12.5v2" />
  </svg>
);

// Google Sheets column ranges accept C, c, C:C and c:c. Store one canonical
// form and prevent accidentally typing Cyrillic letters, digits or spaces.
const sanitizeColumnRange = (value: string) => value.replace(/[^a-zA-Z:]/g, '').toUpperCase();

const PublicTransactions = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  useEffect(() => {
    if (!token) return;

    const publicPath = `/transactions/${token}`;
    const manifestHref = `${import.meta.env.BASE_URL}transactions-manifest.webmanifest`;
    const existingManifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previousManifestHref = existingManifestLink?.getAttribute('href') ?? null;
    const createdManifestLink = !existingManifestLink;
    const manifestLink = existingManifestLink ?? document.createElement('link');
    const previousTitle = document.title;
    let appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const createdAppleTitle = !appleTitle;
    const previousAppleTitle = appleTitle?.content ?? '';

    localStorage.setItem('pwa:last-public-transactions', publicPath);
    document.cookie = `pwa_last_public_transactions=${encodeURIComponent(publicPath)}; path=${import.meta.env.BASE_URL}; max-age=31536000; SameSite=Lax`;

    if (createdManifestLink) {
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = manifestHref;

    if (!appleTitle) {
      appleTitle = document.createElement('meta');
      appleTitle.name = 'apple-mobile-web-app-title';
      document.head.appendChild(appleTitle);
    }
    appleTitle.content = 'Таблица транзакций';
    document.title = 'Таблица транзакций';

    return () => {
      document.title = previousTitle;
      if (createdManifestLink) manifestLink.remove();
      else if (previousManifestHref) manifestLink.href = previousManifestHref;

      if (createdAppleTitle) appleTitle?.remove();
      else if (appleTitle) appleTitle.content = previousAppleTitle;
    };
  }, [token]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [otherRuleSearchTerms, setOtherRuleSearchTerms] = useState<{ income: string[]; expense: string[] }>({
    income: [],
    expense: [],
  });
  const [pendingRuleSearchTerms, setPendingRuleSearchTerms] = useState<{ income: string[]; expense: string[] }>({
    income: [],
    expense: [],
  });
  
  // Filter states
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [addingRuleTerms, setAddingRuleTerms] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [isBankSyncing, setIsBankSyncing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [exportingSourceId, setExportingSourceId] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [sheetRange, setSheetRange] = useState('A:Z');
  const [exportSearchKeyword, setExportSearchKeyword] = useState('');
  const [googleTablePurpose, setGoogleTablePurpose] = useState<'export' | 'reconciliation'>('export');
  const [availableSheetNames, setAvailableSheetNames] = useState<string[]>([]);
  const [isLoadingSheetNames, setIsLoadingSheetNames] = useState(false);
  const [isSavingSheetsSettings, setIsSavingSheetsSettings] = useState(false);
  const [exportSources, setExportSources] = useState<NonNullable<PublicTransactionsResponse['exportSources']>>([]);
  const [editingExportSourceId, setEditingExportSourceId] = useState<string | null>(null);
  const [selectedExportSourceId, setSelectedExportSourceId] = useState('');
  const [registrationSources, setRegistrationSources] = useState<NonNullable<PublicTransactionsResponse['registrationSources']>>([]);
  const [registrationSpreadsheetId, setRegistrationSpreadsheetId] = useState('');
  const [registrationSheetName, setRegistrationSheetName] = useState('');
  const [registrationSheetRange, setRegistrationSheetRange] = useState('A:Z');
  const [registrationNameColumns, setRegistrationNameColumns] = useState('A:B');
  const [registrationAmountColumn, setRegistrationAmountColumn] = useState('');
  const [registrationSearchKeyword, setRegistrationSearchKeyword] = useState('');
  const [editingRegistrationSourceId, setEditingRegistrationSourceId] = useState<string | null>(null);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [isSavingRegistrationSource, setIsSavingRegistrationSource] = useState(false);
  const [reconcilingSourceId, setReconcilingSourceId] = useState<string | null>(null);
  const sheetLoadTimeoutRef = useRef<number | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const nextCursorRef = useRef<PublicTransactionsResponse['nextCursor']>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async (showLoader = true, append = false) => {
      if (showLoader) setLoading(true);
      if (!token) {
        setError('Неправильная ссылка');
        setLoading(false);
        return;
      }

      try {
        const { data, error: functionError } = await supabase.functions.invoke<PublicTransactionsResponse>(
          'public-transactions',
          { body: { token, cursor: append ? nextCursorRef.current : undefined } },
        );

        if (functionError) {
          console.error('Public transactions function error:', functionError);
          throw functionError;
        }

        if (!data?.valid) {
          console.warn('Public transactions link rejected:', data?.error);
          setError('Ссылка не найдена или неактивна');
          setLoading(false);
          return;
        }

        setCategories(data.categories || []);
        setOtherRuleSearchTerms({
          income: data.otherRuleSearchTerms?.income || [],
          expense: data.otherRuleSearchTerms?.expense || [],
        });
        setPendingRuleSearchTerms({
          income: data.pendingRuleSearchTerms?.income || [],
          expense: data.pendingRuleSearchTerms?.expense || [],
        });
        setAllTransactions(current => append ? [...current, ...(data.transactions || [])] : (data.transactions || []));
        if (!append && data.sheetsSettings) {
          setSpreadsheetId(data.sheetsSettings.spreadsheetId || '');
          setSheetName(data.sheetsSettings.sheetName || '');
          setSheetRange(data.sheetsSettings.sheetRange || 'A:Z');
        }
        if (!append) setRegistrationSources(data.registrationSources || []);
        if (!append) {
          const sources = data.exportSources || [];
          setExportSources(sources);
          // A saved destination must be usable immediately after a reload.
          // Keep an existing selection, otherwise choose the first source.
          setSelectedExportSourceId(current =>
            sources.some(source => source.id === current) ? current : (sources[0]?.id || ''),
          );
        }
        setHasMore(Boolean(data.hasMore));
        nextCursorRef.current = data.nextCursor || null;
        /*
        // Get shared link and owner user ID
        const { data: linkData, error: linkError } = await supabase
          .from('shared_transaction_links')
          .select('*')
          .eq('token', token)
          .eq('is_active', true)
          .single();

        if (linkError) {
          console.error('Link error:', linkError);
          setError('Ссылка не найдена или неактивна');
          setLoading(false);
          return;
        }

        if (!linkData) {
          setError('Ссылка не существует');
          setLoading(false);
          return;
        }

        setLinkData(linkData);

        // Load categories for this owner (optional - don't fail if not available)
        try {
          const { data: categoriesData, error: categoriesError } = await supabase
            .from('categories')
            .select('*')
            .eq('user_id', linkData.owner_user_id)
            .order('order', { ascending: true });

          if (categoriesError) {
            console.warn('Categories not available:', categoriesError.message);
            setCategories([]);
          } else {
            setCategories(categoriesData || []);
          }
        } catch (catErr) {
          console.warn('Categories loading failed:', catErr);
          setCategories([]);
        }

        // Load transactions for the link owner
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', linkData.owner_user_id)
          .order('date', { ascending: false });

        if (transactionsError) {
          console.error('Transactions error:', transactionsError);
          throw transactionsError;
        }
        setAllTransactions(transactionsData || []);
        */
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Ошибка при загрузке данных');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleBankSync = async () => {
    setIsBankSyncing(true);
    try {
      if (!token) throw new Error('Неправильная ссылка');
      const { data: result, error: syncError } = await supabase.functions.invoke<PublicTransactionsResponse>(
        'public-transactions',
        { body: { action: 'sync-bank', token } },
      );

      if (syncError) throw syncError;
      if (!result?.success) throw new Error(result?.error || 'Не удалось синхронизировать банк');

      await loadData(false);
      toast({
        title: 'Синхронизация завершена',
        description: (result.imported || 0) > 0
          ? `Добавлено новых транзакций: ${result.imported}`
          : 'Новых банковских транзакций нет',
      });
    } catch (syncError) {
      toast({
        title: 'Ошибка синхронизации банка',
        description: syncError instanceof Error ? syncError.message : String(syncError),
        variant: 'destructive',
      });
    } finally {
      setIsBankSyncing(false);
    }
  };

  const getCategoryName = (categoryId: string): string => {
    const category = categories.find(c => c.id === categoryId);
    return category?.name || 'Неизвестно';
  };

  const getTransactionDepartmentName = (transaction: Transaction): string => {
    if (transaction.departmentName) return transaction.departmentName;

    const categoryName = getCategoryName(transaction.category);
    if (categoryName !== 'Неизвестно') return categoryName;

    return transaction.type === 'income' ? 'Прочее (доход)' : 'Прочее (расход)';
  };

  const isOtherTransaction = (transaction: Transaction): boolean => {
    const department = getTransactionDepartmentName(transaction).toLowerCase();
    return department.includes('прочее');
  };

  const parseSearchTerms = (text: string) =>
    text
      .split(/[,\n]/)
      .map(term => term.trim())
      .filter(Boolean);

  const normalizeSearchText = (text: string) =>
    text
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const compactSearchText = (text: string) =>
    normalizeSearchText(text).replace(/[^a-z0-9а-яёąćęłńóśźż]+/gi, '');

  const getSearchWords = (text: string) =>
    normalizeSearchText(text)
      .split(/[\s\-_.,;:'"«»()[\]{}\/]+/g)
      .map(word => word.trim())
      .filter(word => word.length >= 2);

  const getAllowedRuleWords = (type: 'income' | 'expense') => {
    const words = new Set<string>();

    for (const term of otherRuleSearchTerms[type]) {
      const normalizedTerm = normalizeSearchText(term);
      getSearchWords(term).forEach(word => words.add(word));
      const compactTerm = compactSearchText(normalizedTerm);
      if (compactTerm.length >= 2) words.add(compactTerm);
    }

    return words;
  };

  const getUnavailableRuleWords = (type: 'income' | 'expense') => {
    const words = getAllowedRuleWords(type);

    for (const term of pendingRuleSearchTerms[type]) {
      const normalizedTerm = normalizeSearchText(term);
      getSearchWords(term).forEach(word => words.add(word));
      const compactTerm = compactSearchText(normalizedTerm);
      if (compactTerm.length >= 2) words.add(compactTerm);
    }

    return words;
  };

  const appendPendingRuleTerms = (terms: string[], types: Array<'income' | 'expense'>) => {
    setPendingRuleSearchTerms(prev => {
      const next = {
        income: [...prev.income],
        expense: [...prev.expense],
      };

      for (const type of types) {
        const seen = new Set(next[type].map(term => normalizeSearchText(term)));
        for (const term of terms) {
          const normalizedTerm = term.trim();
          if (!normalizedTerm) continue;
          const key = normalizeSearchText(normalizedTerm);
          if (seen.has(key)) continue;
          seen.add(key);
          next[type].push(normalizedTerm);
        }
      }

      return next;
    });
  };

  const formatMoney = (amount: number, currency: string) =>
    `${amount.toLocaleString()} ${CURRENCY_SYMBOLS[currency as keyof typeof CURRENCY_SYMBOLS] || currency}`;

  const addSearchTermsToRules = async (sourceText = searchText) => {
    const terms = parseSearchTerms(sourceText);
    if (!token || terms.length === 0) return;

    setAddingRuleTerms(true);
    try {
      const types = typeFilter === 'all' ? ['income', 'expense'] : [typeFilter];
      const { data, error: functionError } = await supabase.functions.invoke<PublicTransactionsResponse>(
        'public-transactions',
        {
          body: {
            action: 'add-rule-terms',
            token,
            terms,
            transactionTypes: types,
          },
        },
      );

      if (functionError) throw functionError;
      if (!data?.success) {
        const looksLikeOldFunction = data?.valid && Array.isArray(data.transactions);
        throw new Error(
          looksLikeOldFunction
            ? 'Supabase Function public-transactions еще не обновлена. Нужно дождаться или запустить деплой функций.'
            : data?.error || 'Failed to add words'
        );
      }

      const existingTerms = data.existingTerms || [];
      const addedTerms = data.addedTerms || terms;
      toast({
        title: addedTerms.length ? 'Запрос отправлен' : 'Ключевое слово уже подтверждено',
        description: addedTerms.length
          ? `${addedTerms.join(', ')}: слово появится в поиске после подтверждения${existingTerms.length ? `. ${existingTerms.join(', ')} уже используется` : ''}`
          : `${existingTerms.join(', ')} применяется к поиску, экспорту и сверке`,
      });
      appendPendingRuleTerms(addedTerms, types as Array<'income' | 'expense'>);
      if (sourceText !== searchText) setKeywordDraft('');
    } catch (err) {
      console.error('Error adding public rule terms:', err);
      const message = err instanceof Error ? err.message : 'Не удалось добавить слова в правила';
      toast({
        title: 'Ошибка',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setAddingRuleTerms(false);
    }
  };

  // Filter transactions based on all filter criteria
  const filteredTransactions = allTransactions.filter(t => {
    // Apply type filter
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;

    // Apply currency filter
    if (currencyFilter !== 'all' && t.currency !== currencyFilter) return false;

    // Apply date range filter
    if (customDateRange.from || customDateRange.to) {
      const txDate = new Date(t.date);
      if (customDateRange.from && txDate < customDateRange.from) return false;
      if (customDateRange.to) {
        const endDate = new Date(customDateRange.to);
        endDate.setHours(23, 59, 59, 999);
        if (txDate > endDate) return false;
      }
    }

    // Apply text search - exact word match in description, bankTitle, and names
    if (searchText.trim()) {
      const searchWords = getSearchWords(searchText); // Minimum 2 characters

      if (searchWords.length === 0) return false; // No valid search words

      const normalizedComment = normalizeSearchText(t.comment || '');
      const commentWords = normalizedComment
        .split(/[\s\-_.,;:'"«»()[\]{}\/]+/)
        .filter(word => word.length >= 2)
        .concat(compactSearchText(t.comment || ''));
      const allowedRuleWords = getAllowedRuleWords(t.type);
      // The first word is the approved event keyword (for example, "777").
      // The following words narrow results by a name or transaction text.
      const keyWord = searchWords[0];
      if (!allowedRuleWords.has(keyWord) && !commentWords.some(commentWord => commentWord.includes(keyWord))) return false;

      // Combine all searchable text fields
      const fullSearchableText = [
        t.description || '',
        t.bankTitle || '',
        t.bankSender || '',
        t.bankRecipient || '',
        t.issuedTo || '',
        t.cashierName || '',
        t.comment || '',
        getTransactionDepartmentName(t)
      ].join(' ');
      const normalizedSearchableText = normalizeSearchText(fullSearchableText);

      // Split by word separators and filter out short words
      const allWords = normalizedSearchableText
        .split(/[\s\-_.,;:'"«»()[\]{}\/]+/)
        .filter(w => w.length >= 2)
        .concat(compactSearchText(fullSearchableText)); // Also search joined words

      // Check if ALL search words are found as complete words in the text
      const hasAllWords = searchWords.every(searchWord =>
        allWords.some(textWord => textWord.includes(searchWord))
      );

      if (!hasAllWords) return false;
    }

    return true;
  });

  // Calculate filtered totals
  const totals = filteredTransactions.reduce((acc, t) => {
    if (!acc[t.currency]) {
      acc[t.currency] = { income: 0, expense: 0 };
    }
    if (t.type === 'income') {
      acc[t.currency].income += t.amount;
    } else {
      acc[t.currency].expense += t.amount;
    }
    return acc;
  }, {} as Record<string, { income: number; expense: number }>);

  // Get available currencies from all transactions
  const availableCurrencies = Array.from(new Set(allTransactions.map(t => t.currency)));

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Show transactions ONLY when search text is entered (filters apply only with search)
  const hasActiveFilters = searchText.trim() !== '';
  const allRuleTypes: Array<'income' | 'expense'> = ['income', 'expense'];
  const searchWordsForRules = getSearchWords(searchText);
  const hasConfirmedKeyword = searchWordsForRules.length > 0
    && allRuleTypes.some(type => getAllowedRuleWords(type).has(searchWordsForRules[0]));
  const canAddSearchTerms =
    searchWordsForRules.length > 0 &&
    searchWordsForRules.some(word =>
      allRuleTypes.every(type => !getUnavailableRuleWords(type).has(word))
    );
  const hasSearchOrFilters =
    searchText.trim() !== '' ||
    typeFilter !== 'all' ||
    currencyFilter !== 'all' ||
    Boolean(customDateRange.from || customDateRange.to);

  const resetAllFilters = () => {
    setSearchText('');
    setTypeFilter('all');
    setCurrencyFilter('all');
    setCustomDateRange({});
    setShowAdvancedFilters(false);
  };

  const rowsForSourceKeyword = (keyword: string) => {
    const words = getSearchWords(keyword);
    if (words.length === 0) return [];
    return allTransactions.filter(transaction => {
      const text = normalizeSearchText([
        transaction.description,
        transaction.bankTitle,
        transaction.bankSender,
        transaction.bankRecipient,
        transaction.comment,
      ].filter(Boolean).join(' '));
      return words.every(word => text.includes(word));
    });
  };

  const exportToGoogleSheets = async (source: NonNullable<PublicTransactionsResponse['exportSources']>[number]) => {
    const rows = rowsForSourceKeyword(source.search_keyword);
    if (!source.search_keyword.trim()) {
      toast({ title: 'Укажите ключевое слово для этой таблицы', variant: 'destructive' });
      return;
    }
    if (!token || rows.length === 0) {
      toast({ title: 'Нет данных для экспорта', variant: 'destructive' });
      return;
    }
    if (!window.confirm(`Экспортировать ${rows.length} транзакций в настроенную Google Таблицу? Текущие данные листа будут заменены.`)) return;

    setExportingSourceId(source.id);
    try {
      const { data, error: functionError } = await supabase.functions.invoke<PublicTransactionsResponse>(
        'public-transactions',
        {
          body: {
            action: 'export-sheets',
            token,
            targetId: source.id,
            transactionIds: rows.map(row => row.id),
            // The phrase selects transactions but must not be part of the exported name.
            exportKeywords: [source.search_keyword],
          },
        },
      );
      if (functionError) throw functionError;
      if (!data?.success) throw new Error(data?.error || 'Не удалось экспортировать данные');
      toast({ title: 'Экспорт завершён', description: `В Google Таблицу отправлено строк: ${data.exported || rows.length}` });
    } catch (exportError) {
      toast({
        title: 'Ошибка экспорта',
        description: exportError instanceof Error ? exportError.message : 'Проверьте настройку Google Таблицы',
        variant: 'destructive',
      });
    } finally {
      setExportingSourceId(null);
    }
  };

  const saveSheetsSettings = async () => {
    if (!token) return false;
    if (!spreadsheetId.trim()) {
      toast({ title: 'Укажите ссылку или ID Google Таблицы', variant: 'destructive' });
      return false;
    }

    setIsSavingSheetsSettings(true);
    try {
      const { data, error: functionError } = await supabase.functions.invoke<PublicTransactionsResponse>(
        'public-transactions',
        {
          body: {
            action: 'save-export-source',
            token,
            sourceId: editingExportSourceId || undefined,
            spreadsheetId,
            sheetName,
            sheetRange,
            searchKeyword: exportSearchKeyword,
          },
        },
      );
      if (functionError) throw functionError;
      if (!data?.success) throw new Error(data?.error || 'Не удалось сохранить настройки Google Sheets');
      setEditingExportSourceId(null);
      setSpreadsheetId(''); setSheetName(''); setSheetRange('A:Z'); setExportSearchKeyword('');
      if (data.source?.id) setSelectedExportSourceId(data.source.id);
      await loadData(false);
      toast({ title: 'Таблица экспорта добавлена' });
      return true;
    } catch (settingsError) {
      toast({
        title: 'Ошибка сохранения',
        description: settingsError instanceof Error ? settingsError.message : 'Проверьте настройки таблицы',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsSavingSheetsSettings(false);
    }
  };

  const editExportSource = (source: NonNullable<PublicTransactionsResponse['exportSources']>[number]) => {
    setEditingExportSourceId(source.id);
    setSpreadsheetId(source.spreadsheet_id);
    setSheetName(source.sheet_name);
    setSheetRange(source.sheet_range);
    setExportSearchKeyword(source.search_keyword || '');
    setSelectedExportSourceId(source.id);
  };

  const deleteExportSource = async (sourceId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.functions.invoke<PublicTransactionsResponse>('public-transactions', { body: { action: 'delete-export-source', token, sourceId } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось удалить таблицу');
      setExportSources(current => current.filter(source => source.id !== sourceId));
      if (selectedExportSourceId === sourceId) setSelectedExportSourceId('');
    } catch (error) { toast({ title: 'Ошибка удаления', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }); }
  };

  const loadSheetNames = async (spreadsheetInput: string) => {
    if (!token || !spreadsheetInput.trim()) return;
    setIsLoadingSheetNames(true);
    try {
      const { data, error } = await supabase.functions.invoke<PublicTransactionsResponse>('public-transactions', {
        body: { action: 'list-sheets', token, spreadsheetId: spreadsheetInput },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось прочитать листы таблицы');
      const names = data.sheets || [];
      setAvailableSheetNames(names);
      if (googleTablePurpose === 'export' && !sheetName && names[0]) setSheetName(names[0]);
      if (googleTablePurpose === 'reconciliation' && !registrationSheetName && names[0]) setRegistrationSheetName(names[0]);
    } catch (error) {
      setAvailableSheetNames([]);
      toast({ title: 'Не удалось получить листы', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setIsLoadingSheetNames(false);
    }
  };

  const scheduleSheetNamesLoad = (spreadsheetInput: string, purpose: 'export' | 'reconciliation') => {
    window.clearTimeout(sheetLoadTimeoutRef.current);
    setAvailableSheetNames([]);
    if (purpose === 'export') setSheetName('');
    else setRegistrationSheetName('');
    if (spreadsheetInput.trim().length < 20) {
      setIsLoadingSheetNames(false);
      return;
    }
    setIsLoadingSheetNames(true);
    sheetLoadTimeoutRef.current = window.setTimeout(() => void loadSheetNames(spreadsheetInput), 250);
  };

  const saveRegistrationSource = async () => {
    if (!token || !registrationSpreadsheetId.trim()) return;
    setIsSavingRegistrationSource(true);
    try {
      const { data, error } = await supabase.functions.invoke<PublicTransactionsResponse>('public-transactions', {
        body: { action: 'save-registration-source', token, sourceId: editingRegistrationSourceId || undefined, spreadsheetId: registrationSpreadsheetId, sheetName: registrationSheetName, sheetRange: registrationSheetRange, nameColumns: registrationSheetRange, amountColumn: registrationAmountColumn, searchKeyword: registrationSearchKeyword },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось добавить таблицу');
      setRegistrationSpreadsheetId(''); setRegistrationSheetName(''); setRegistrationSheetRange('A:Z'); setRegistrationNameColumns('A:B'); setRegistrationAmountColumn(''); setRegistrationSearchKeyword(''); setEditingRegistrationSourceId(null);
      await loadData(false);
      toast({ title: editingRegistrationSourceId ? 'Настройки таблицы обновлены' : 'Таблица регистрации добавлена' });
    } catch (error) {
      toast({ title: 'Ошибка сохранения', description: error instanceof Error ? error.message : 'Проверьте настройки таблицы', variant: 'destructive' });
    } finally { setIsSavingRegistrationSource(false); }
  };

  const editRegistrationSource = (source: NonNullable<PublicTransactionsResponse['registrationSources']>[number]) => {
    setEditingRegistrationSourceId(source.id);
    setRegistrationSpreadsheetId(source.spreadsheet_id);
    setRegistrationSheetName(source.sheet_name);
    setRegistrationSheetRange(source.sheet_range);
    setRegistrationNameColumns(source.name_columns);
    setRegistrationAmountColumn(source.amount_column || '');
    setRegistrationSearchKeyword(source.search_keyword || '');
  };

  const cancelRegistrationSourceEdit = () => {
    setEditingRegistrationSourceId(null);
    setRegistrationSpreadsheetId('');
    setRegistrationSheetName('');
    setRegistrationSheetRange('A:Z');
    setRegistrationNameColumns('A:B');
    setRegistrationAmountColumn('');
    setRegistrationSearchKeyword('');
  };

  const deleteRegistrationSource = async (sourceId: string) => {
    if (!token) return;
    try {
      const { data, error } = await supabase.functions.invoke<PublicTransactionsResponse>('public-transactions', { body: { action: 'delete-registration-source', token, sourceId } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось удалить таблицу');
      setRegistrationSources(current => current.filter(source => source.id !== sourceId));
    } catch (error) { toast({ title: 'Ошибка удаления', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }); }
  };

  const reconcileRegistrationSheets = async (source: NonNullable<PublicTransactionsResponse['registrationSources']>[number]) => {
    if (!token) return;
    if (!source.search_keyword.trim()) {
      toast({ title: 'Укажите ключевое слово для этой таблицы', variant: 'destructive' });
      return;
    }
    setReconcilingSourceId(source.id);
    try {
      const { data, error } = await supabase.functions.invoke<PublicTransactionsResponse & { matched?: number }>('public-transactions', {
        body: {
          action: 'reconcile-registration-sheets',
          token,
          sourceId: source.id,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Не удалось выполнить сверку');
      toast({ title: 'Сверка завершена', description: `Совпадений отмечено: ${data.matched || 0}` });
    } catch (error) { toast({ title: 'Ошибка сверки', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }); }
    finally { setReconcilingSourceId(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-destructive text-lg mb-4">{error}</p>
          <Button onClick={() => window.history.back()}>Назад</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background p-4 sm:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Header actions */}
          <div className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-3xl font-bold">Таблица транзакций</h1>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBankSync}
                  disabled={isBankSyncing}
                  className="h-11 gap-1.5 whitespace-nowrap px-3 sm:px-4"
                  aria-label="Поиск новых транзакций"
                  title="Поиск новых транзакций"
                >
                  <CloudSyncIcon className={cn("h-5 w-5", isBankSyncing && "animate-pulse")} />
                  <span className="hidden sm:inline">
                    {isBankSyncing ? 'Поиск...' : 'Поиск новых транзакций'}
                  </span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={addSearchTermsToRules}
                  disabled={!canAddSearchTerms || addingRuleTerms}
                  className="h-11 gap-2 whitespace-nowrap px-3 sm:px-4"
                  aria-label="Добавить слово для поиска"
                  title="Добавить слово для поиска"
                >
                  <DocumentKeywordIcon className={cn("h-5 w-5", addingRuleTerms && "animate-pulse")} />
                  <span className="hidden sm:inline">Добавить слово для поиска</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowSettings(true);
                  }}
                  className="h-11 gap-2 whitespace-nowrap px-3 sm:px-4"
                  aria-label="Настройки"
                  title="Настройки"
                >
                  <Settings className="h-5 w-5" />
                  <span className="hidden sm:inline">Настройки</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Search and filters */}
          <div className="mb-6 space-y-3">
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск транзакции по ключевому слову."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className={cn("h-12 pl-10 text-base", hasSearchOrFilters ? "pr-24" : "pr-12")}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAdvancedFilters(prev => !prev)}
                  className={cn(
                    "absolute top-1/2 h-10 w-10 -translate-y-1/2 text-muted-foreground hover:text-foreground",
                    hasSearchOrFilters ? "right-11" : "right-1",
                    showAdvancedFilters && "text-primary"
                  )}
                  aria-label="Фильтры"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </Button>
                {hasSearchOrFilters && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={resetAllFilters}
                    className="absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Сбросить поиск и все фильтры"
                    title="Сбросить поиск и все фильтры"
                  >
                    <X className="h-5 w-5" strokeWidth={2.5} />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: 'all', label: 'Все' },
                { value: 'income', label: 'Доходы' },
                { value: 'expense', label: 'Расходы' },
              ].map(filter => (
                <Button
                  key={filter.value}
                  type="button"
                  variant={typeFilter === filter.value ? 'default' : 'outline'}
                  onClick={() => setTypeFilter(filter.value as 'all' | 'income' | 'expense')}
                  className="h-11 rounded-lg px-5 text-base font-semibold"
                >
                  {filter.label}
                </Button>
              ))}

            </div>

            {showAdvancedFilters && (
              <div className="grid gap-3 rounded-lg border border-border bg-card/60 p-3 sm:grid-cols-2 lg:grid-cols-[170px_190px_auto]">

              {/* Currency Filter */}
              {availableCurrencies.length > 0 && (
                <div>
                  <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                    <SelectTrigger className="h-10 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все валюты</SelectItem>
                      {availableCurrencies.map(currency => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date Range */}
              <div>
                <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
              </div>

              </div>
            )}
          </div>

          {/* Filtered Totals */}
          {hasActiveFilters && filteredTransactions.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs text-muted-foreground mb-3 font-medium">
                Итого по результатам · Транзакций: {filteredTransactions.length}
              </p>
              <div className="flex flex-wrap gap-4">
                {Object.entries(totals).map(([currency, { income, expense }]) => (
                  <div key={currency}>
                    <p className={cn(
                      "text-sm font-bold mb-1",
                      income - expense >= 0 ? "text-success" : "text-destructive"
                    )}>
                      {formatMoney(income - expense, currency)}
                    </p>
                    <div className="flex items-center gap-1 text-success mb-1">
                      <TrendingUp className="w-3 h-3" />
                      <span className="text-sm font-semibold">+{formatMoney(income, currency)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-destructive">
                      <TrendingDown className="w-3 h-3" />
                      <span className="text-sm font-semibold">-{formatMoney(expense, currency)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No Data Message */}
          {!hasActiveFilters && (
            <Card>
              <CardContent className="py-16">
                <div className="text-center">
                  <p className="text-muted-foreground mb-2">Введите текст поиска для просмотра транзакций</p>
                  <p className="text-sm text-muted-foreground">
                    Используйте поле поиска выше для поиска по словам в описании, названии или именах
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Transactions */}
          {hasActiveFilters && filteredTransactions.length === 0 && (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground">
                  Нет результатов поиска
                </p>
              </CardContent>
            </Card>
          )}

          {hasActiveFilters && filteredTransactions.length > 0 && (
            <div className="space-y-2">
              {filteredTransactions.map((transaction) => {
                const isExpanded = expandedIds.has(transaction.id);
                return (
                  <Card key={transaction.id} className="overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={cn(
                            'p-2 rounded-lg flex-shrink-0',
                            transaction.type === 'income'
                              ? 'bg-success/10 text-success'
                              : 'bg-destructive/10 text-destructive'
                          )}>
                            {transaction.type === 'income' ? (
                              <TrendingUp className="w-4 h-4" />
                            ) : (
                              <TrendingDown className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-sm">
                              {getTransactionDepartmentName(transaction)}
                            </p>
                            {transaction.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {transaction.description}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {format(new Date(transaction.date), 'dd.MM.yyyy')}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="text-right">
                            <span className={cn(
                              'text-sm font-bold',
                              transaction.type === 'income' ? 'text-success' : 'text-destructive'
                            )}>
                              {transaction.type === 'income' ? '+' : '-'}
                              {transaction.amount.toLocaleString()} {CURRENCY_SYMBOLS[transaction.currency]}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 flex-shrink-0"
                            onClick={() => toggleExpand(transaction.id)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="p-4 bg-muted/30 border-t">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            {transaction.type && (
                              <div>
                                <p className="text-muted-foreground text-xs">Тип</p>
                                <p className={cn(
                                  'font-medium',
                                  transaction.type === 'income' ? 'text-success' : 'text-destructive'
                                )}>
                                  {transaction.type === 'income' ? 'Доход' : 'Расход'}
                                </p>
                              </div>
                            )}
                            {transaction.currency && (
                              <div>
                                <p className="text-muted-foreground text-xs">Валюта</p>
                                <p className="font-medium">{transaction.currency}</p>
                              </div>
                            )}
                            {transaction.departmentName && (
                              <div>
                                <p className="text-muted-foreground text-xs">Название отдела</p>
                                <p className="font-medium">{transaction.departmentName}</p>
                              </div>
                            )}
                            {transaction.bankTitle && (
                              <div className="col-span-2 md:col-span-4">
                                <p className="text-muted-foreground text-xs">Назначение</p>
                                <p className="font-medium">{transaction.bankTitle}</p>
                              </div>
                            )}
                            {transaction.description && transaction.description !== transaction.bankTitle && (
                              <div className="col-span-2 md:col-span-4">
                                <p className="text-muted-foreground text-xs">Описание</p>
                                <p className="font-medium">{transaction.description}</p>
                              </div>
                            )}
                            {transaction.bankSender && (
                              <div className="col-span-2 md:col-span-2">
                                <p className="text-muted-foreground text-xs">От кого</p>
                                <p className="font-medium">{transaction.bankSender}</p>
                              </div>
                            )}
                            {transaction.comment && (
                              <div className="col-span-2 md:col-span-4">
                                <p className="text-muted-foreground text-xs">Комментарий</p>
                                <p className="font-medium">{transaction.comment}</p>
                              </div>
                            )}
                            {transaction.bankRecipient && (
                              <div className="col-span-2 md:col-span-2">
                                <p className="text-muted-foreground text-xs">Кому</p>
                                <p className="font-medium">{transaction.bankRecipient}</p>
                              </div>
                            )}
                            {transaction.issuedTo && (
                              <div className="col-span-2 md:col-span-2">
                                <p className="text-muted-foreground text-xs">Выдано</p>
                                <p className="font-medium">{transaction.issuedTo}</p>
                              </div>
                            )}
                            {transaction.cashierName && (
                              <div className="col-span-2 md:col-span-2">
                                <p className="text-muted-foreground text-xs">Кассир</p>
                                <p className="font-medium">{transaction.cashierName}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {hasMore && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void loadData(false, true);
                }}
              >
                {loadingMore ? 'Загрузка…' : 'Показать ещё 500'}
              </Button>
            </div>
          )}

          {/* Footer info */}
          {hasActiveFilters && (
            <div className="mt-6 text-center text-xs text-muted-foreground">
              <p>Показано транзакций: {filteredTransactions.length}</p>
            </div>
          )}
        </div>
      </div>
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки публичной таблицы</DialogTitle>
            <DialogDescription>
              Сохраните быстрые ключи поиска или экспортируйте текущие результаты в Google Таблицу владельца.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="rounded-lg border p-3 space-y-2">
              <label htmlFor="public-keyword" className="text-sm font-medium">Ключевое слово поиска</label>
              <div className="flex gap-2">
                <Input
                  id="public-keyword"
                  value={keywordDraft}
                  onChange={event => setKeywordDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addSearchTermsToRules(keywordDraft);
                    }
                  }}
                  placeholder="Например: 777"
                />
                <Button
                  type="button"
                  size="icon"
                  onClick={() => void addSearchTermsToRules(keywordDraft)}
                  disabled={!parseSearchTerms(keywordDraft).length || addingRuleTerms}
                  aria-label="Добавить ключевое слово"
                  title="Добавить ключевое слово"
                >
                  {addingRuleTerms ? <Loader2 className="h-4 w-4 animate-spin" /> : '+'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Слово будет отправлено владельцу на подтверждение и после подтверждения начнёт использоваться для поиска новых транзакций.</p>
            </div>
            <div className="rounded-lg border p-3 space-y-3">
              <div className="space-y-1">
                <p className="font-medium">Google Таблица</p>
                <p className="text-xs text-muted-foreground">Выберите назначение таблицы, затем заполните её параметры.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <label className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <input type="checkbox" checked={googleTablePurpose === 'export'} onChange={() => setGoogleTablePurpose('export')} />
                  Экспорт
                </label>
                <label className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <input type="checkbox" checked={googleTablePurpose === 'reconciliation'} onChange={() => setGoogleTablePurpose('reconciliation')} />
                  Сверка регистраций
                </label>
              </div>
            </div>
            {googleTablePurpose === 'export' && <div className="rounded-lg border p-3">
              <div className="mb-4 space-y-3">
                <div className="space-y-2">
                  <label htmlFor="public-spreadsheet-id" className="text-sm font-medium">ID таблицы или ссылка</label>
                  <Input
                    id="public-spreadsheet-id"
                    value={spreadsheetId}
                    onChange={event => {
                      const value = event.target.value;
                      setSpreadsheetId(value);
                      scheduleSheetNamesLoad(value, 'export');
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/... или ID"
                  />
                  <p className="text-xs text-muted-foreground">Вставьте ссылку на Google Таблицу или только её ID.</p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="public-sheet-name" className="text-sm font-medium">Название листа</label>
                  {isLoadingSheetNames ? (
                    <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка листов…</div>
                  ) : (
                    <select id="public-sheet-name" value={sheetName} onChange={event => setSheetName(event.target.value)} disabled={availableSheetNames.length === 0} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                      <option value="">Выберите лист</option>
                      {availableSheetNames.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                  )}
                </div>
                <div className="space-y-2">
                  <label htmlFor="public-sheet-range" className="text-sm font-medium">Диапазон листа</label>
                  <Input
                    id="public-sheet-range"
                    value={sheetRange}
                    onChange={event => setSheetRange(sanitizeColumnRange(event.target.value))}
                    pattern="[A-Za-z:]*"
                    placeholder="A:Z или B"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="public-sheet-keyword" className="text-sm font-medium">Ключевое слово этой таблицы</label>
                  <Input id="public-sheet-keyword" value={exportSearchKeyword} onChange={event => setExportSearchKeyword(event.target.value)} placeholder="Например: 777 или coram deo" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={saveSheetsSettings}
                  disabled={isSavingSheetsSettings || !exportSearchKeyword.trim()}
                >
                  {isSavingSheetsSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editingExportSourceId ? 'Сохранить изменения' : 'Добавить Google Таблицу'}
                </Button>
                {exportSources.map(source => (
                  <div key={source.id} className="space-y-2 rounded border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate">{source.sheet_name || 'Первый лист'} · {source.sheet_range} · ключ: {source.search_keyword || 'не указан'}</span>
                      <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => editExportSource(source)} aria-label="Редактировать таблицу"><Pencil className="h-4 w-4" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteExportSource(source.id)} aria-label="Удалить таблицу"><X className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <Button type="button" className="w-full" onClick={() => exportToGoogleSheets(source)} disabled={Boolean(exportingSourceId) || !source.search_keyword.trim() || rowsForSourceKeyword(source.search_keyword).length === 0}>
                      {exportingSourceId === source.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Table2 className="mr-2 h-4 w-4" />} Экспортировать в эту Google Таблицу
                    </Button>
                  </div>
                ))}
              </div>
            </div>}
            {googleTablePurpose === 'reconciliation' && <div className="rounded-lg border p-3 space-y-3">
              <div>
                <p className="font-medium">Таблицы регистрации</p>
                <p className="text-xs text-muted-foreground">Добавьте лист Google Forms с именем и фамилией. При сверке совпадения с входящими транзакциями выделяются зелёным, а в ячейку добавляется примечание с транзакцией.</p>
              </div>
              <Input value={registrationSpreadsheetId} onChange={event => {
                const value = event.target.value;
                setRegistrationSpreadsheetId(value);
                scheduleSheetNamesLoad(value, 'reconciliation');
              }} placeholder="Ссылка на Google Таблицу" />
              <div className="grid grid-cols-2 gap-2">
                {isLoadingSheetNames ? (
                  <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка…</div>
                ) : (
                  <select value={registrationSheetName} onChange={event => setRegistrationSheetName(event.target.value)} disabled={availableSheetNames.length === 0} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60">
                    <option value="">Выберите лист</option>
                    {availableSheetNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                )}
                <Input value={registrationSheetRange} onChange={event => setRegistrationSheetRange(sanitizeColumnRange(event.target.value))} pattern="[A-Za-z:]*" placeholder="Диапазон, например A:Z или C" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Ключевое слово этой регистрации</label>
                <Input value={registrationSearchKeyword} onChange={event => setRegistrationSearchKeyword(event.target.value)} placeholder="Например: 777 или coram deo" />
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={saveRegistrationSource} disabled={isSavingRegistrationSource || !registrationSpreadsheetId.trim() || !registrationSearchKeyword.trim()}>
                {isSavingRegistrationSource && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {editingRegistrationSourceId ? 'Сохранить изменения' : 'Добавить таблицу регистрации'}
              </Button>
              {editingRegistrationSourceId && <Button type="button" variant="ghost" className="w-full" onClick={cancelRegistrationSourceEdit}>Отменить редактирование</Button>}
              {registrationSources.map(source => (
                <div key={source.id} className="space-y-2 rounded border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{source.sheet_name || 'Первый лист'} · {source.name_columns} · ключ: {source.search_keyword || 'не указан'}</span>
                    <div className="flex shrink-0 items-center">
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => editRegistrationSource(source)} aria-label="Редактировать таблицу" title="Редактировать таблицу"><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteRegistrationSource(source.id)} aria-label="Удалить таблицу"><X className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <Button type="button" className="w-full" onClick={() => reconcileRegistrationSheets(source)} disabled={Boolean(reconcilingSourceId) || !source.search_keyword.trim()}>
                    {reconcilingSourceId === source.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Сверить эту регистрацию с транзакциями
                  </Button>
                </div>
              ))}
            </div>}
          </div>
        </DialogContent>
      </Dialog>
      <Toaster />
    </>
  );
};

export default PublicTransactions;
