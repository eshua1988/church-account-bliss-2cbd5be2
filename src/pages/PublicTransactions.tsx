import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, ChevronDown, ChevronUp, TrendingUp, TrendingDown, SlidersHorizontal, RefreshCw, Landmark } from 'lucide-react';
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
  addedTerms?: string[];
}

const PublicTransactions = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

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
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async (showLoader = true) => {
      if (showLoader) setLoading(true);
      if (!token) {
        setError('Неправильная ссылка');
        setLoading(false);
        return;
      }

      try {
        const { data, error: functionError } = await supabase.functions.invoke<PublicTransactionsResponse>(
          'public-transactions',
          { body: { token } },
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
        setAllTransactions(data.transactions || []);
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
      }
  }, [token]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleBankSync = async () => {
    setIsBankSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        toast({
          title: 'Требуется авторизация',
          description: 'Синхронизация банков доступна владельцу после входа в приложение',
          variant: 'destructive',
        });
        return;
      }

      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const response = await fetch(`${supabaseUrl}/functions/v1/banking-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: session.user.id }),
      });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));

      if (!response.ok) {
        throw new Error(result?.error || `HTTP ${response.status}`);
      }

      await loadData(false);
      toast({
        title: 'Синхронизация завершена',
        description: result.imported > 0
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

  const addSearchTermsToRules = async () => {
    const terms = parseSearchTerms(searchText);
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

      toast({
        title: 'Запрос отправлен',
        description: 'Слова появятся в поиске после подтверждения',
      });
      appendPendingRuleTerms(data.addedTerms || terms, types as Array<'income' | 'expense'>);
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
      if (!isOtherTransaction(t)) return false;

      const searchWords = getSearchWords(searchText); // Minimum 2 characters

      if (searchWords.length === 0) return false; // No valid search words

      const allowedRuleWords = getAllowedRuleWords(t.type);
      if (allowedRuleWords.size === 0) return false;
      if (!searchWords.every(searchWord => allowedRuleWords.has(searchWord))) return false;

      // Combine all searchable text fields
      const fullSearchableText = [
        t.description || '',
        t.bankTitle || '',
        t.bankSender || '',
        t.bankRecipient || '',
        t.issuedTo || '',
        t.cashierName || '',
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
  const canAddSearchTerms =
    searchWordsForRules.length > 0 &&
    searchWordsForRules.some(word =>
      allRuleTypes.every(type => !getUnavailableRuleWords(type).has(word))
    );

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
              <div>
                <h1 className="text-3xl font-bold mb-2">Таблица транзакций</h1>
                <p className="text-muted-foreground">
                  {hasActiveFilters
                    ? `Найдено транзакций: ${filteredTransactions.length}`
                    : 'Введите текст поиска для просмотра транзакций'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBankSync}
                  disabled={isBankSyncing}
                  className="h-11 gap-2 whitespace-nowrap"
                >
                  {isBankSyncing
                    ? <RefreshCw className="h-4 w-4 animate-spin" />
                    : <Landmark className="h-4 w-4" />}
                  {isBankSyncing ? 'Синхронизация...' : 'Синхронизировать банки Польши'}
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
                  placeholder="Поиск только в Прочее (доход) и Прочее (расход). Несколько слов можно через запятую..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="h-12 pl-10 pr-12 text-base"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAdvancedFilters(prev => !prev)}
                  className={cn(
                    "absolute right-1 top-1/2 h-10 w-10 -translate-y-1/2 text-muted-foreground hover:text-foreground",
                    showAdvancedFilters && "text-primary"
                  )}
                  aria-label="Фильтры"
                >
                  <SlidersHorizontal className="h-5 w-5" />
                </Button>
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

              <Button
                variant="outline"
                onClick={addSearchTermsToRules}
                disabled={!canAddSearchTerms || addingRuleTerms}
                className="h-11 rounded-lg px-5 text-base font-semibold"
              >
                Добавить слово для поиска
              </Button>

              <Button
                variant="ghost"
                onClick={() => {
                  setSearchText('');
                  setTypeFilter('all');
                  setCurrencyFilter('all');
                  setCustomDateRange({});
                  setShowAdvancedFilters(false);
                }}
                className="h-11 rounded-lg px-5 text-base font-semibold text-muted-foreground"
              >
                Сбросить все настройки
              </Button>
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
              <p className="text-xs text-muted-foreground mb-3 font-medium">Итого по результатам:</p>
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
                            {transaction.source === 'enablebanking' ? (
                              transaction.bankTitle && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-muted-foreground text-xs">Назначение</p>
                                  <p className="font-medium">{transaction.bankTitle}</p>
                                </div>
                              )
                            ) : (
                              transaction.description && (
                                <div className="col-span-2 md:col-span-4">
                                  <p className="text-muted-foreground text-xs">Описание</p>
                                  <p className="font-medium">{transaction.description}</p>
                                </div>
                              )
                            )}
                            {transaction.bankSender && (
                              <div className="col-span-2 md:col-span-2">
                                <p className="text-muted-foreground text-xs">От кого</p>
                                <p className="font-medium">{transaction.bankSender}</p>
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

          {/* Footer info */}
          {hasActiveFilters && (
            <div className="mt-6 text-center text-xs text-muted-foreground">
              <p>Показано транзакций: {filteredTransactions.length}</p>
            </div>
          )}
        </div>
      </div>
      <Toaster />
    </>
  );
};

export default PublicTransactions;
