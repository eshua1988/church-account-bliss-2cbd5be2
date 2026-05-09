import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, ChevronDown, ChevronUp, TrendingUp, TrendingDown } from 'lucide-react';
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
  
  // Filter states
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [addingRuleTerms, setAddingRuleTerms] = useState(false);
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadData = async () => {
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
    };

    loadData();
  }, [token]);

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
        title: 'Слова добавлены',
        description: terms.join(', '),
      });
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

      const searchWords = searchText.trim().toLowerCase().split(/[\s\-_.,;:'"«»()[\]{}]/g).filter(w => w.length >= 2); // Minimum 2 characters

      if (searchWords.length === 0) return false; // No valid search words

      // Combine all searchable text fields
      const fullSearchableText = [
        t.description || '',
        t.bankTitle || '',
        t.bankSender || '',
        t.bankRecipient || '',
        t.issuedTo || '',
        t.cashierName || '',
        getTransactionDepartmentName(t)
      ].join(' ').toLowerCase();

      // Split by word separators and filter out short words
      const allWords = fullSearchableText
        .split(/[\s\-_.,;:'"«»()[\]{}\/]+/)
        .filter(w => w.length >= 2); // Only words with 2+ characters

      // Check if ALL search words are found as complete words in the text
      const hasAllWords = searchWords.every(searchWord =>
        allWords.some(textWord => textWord === searchWord)
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
  const canAddSearchTerms = parseSearchTerms(searchText).length > 0;

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
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold mb-2">Таблица транзакций</h1>
            <p className="text-muted-foreground">
              {hasActiveFilters 
                ? `Найдено транзакций: ${filteredTransactions.length}` 
                : 'Введите текст поиска для просмотра транзакций'}
            </p>
          </div>

          {/* Search and filters */}
          <div className="mb-6 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск только в Прочее (доход) и Прочее (расход). Несколько слов можно через запятую..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="h-10 pl-8 text-sm"
                />
              </div>

              {/* Type Filter */}
              <div className="lg:w-[150px]">
                <Select value={typeFilter} onValueChange={(val) => setTypeFilter(val as any)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="income">Доход</SelectItem>
                    <SelectItem value="expense">Расход</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Currency Filter */}
              {availableCurrencies.length > 0 && (
                <div className="lg:w-[170px]">
                  <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                    <SelectTrigger className="h-9 text-sm">
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
              <div className="lg:w-[190px]">
                <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addSearchTermsToRules}
                disabled={!canAddSearchTerms || addingRuleTerms}
              >
                Добавить слова в Прочее
              </Button>

            {/* Reset Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchText('');
                  setTypeFilter('all');
                  setCurrencyFilter('all');
                  setCustomDateRange({});
                }}
                className="text-xs text-muted-foreground"
              >
                Сбросить все фильтры
              </Button>
            )}
            </div>
          </div>

          {/* Filtered Totals */}
          {hasActiveFilters && filteredTransactions.length > 0 && (
            <div className="mb-6 p-4 rounded-lg bg-primary/5 border border-primary/20">
              <p className="text-xs text-muted-foreground mb-3 font-medium">Итого по результатам:</p>
              <div className="flex flex-wrap gap-4">
                {Object.entries(totals).map(([currency, { income, expense }]) => (
                  <div key={currency}>
                    <p className="text-xs text-muted-foreground font-medium mb-1">{currency}</p>
                    <div className="flex items-center gap-1 text-success mb-1">
                      <TrendingUp className="w-3 h-3" />
                      <span className="text-sm font-semibold">+{income.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1 text-destructive">
                      <TrendingDown className="w-3 h-3" />
                      <span className="text-sm font-semibold">-{expense.toLocaleString()}</span>
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
