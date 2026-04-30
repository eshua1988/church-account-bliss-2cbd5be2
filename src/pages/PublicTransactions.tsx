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
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';
import DateRangeFilter from '@/components/DateRangeFilter';

interface PublicLink {
  id: string;
  token: string;
  owner_user_id: string;
  is_active: boolean;
}

interface Category {
  id: string;
  name: string;
  type: string;
}

const PublicTransactions = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkData, setLinkData] = useState<PublicLink | null>(null);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  
  // Filter states
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [currencyFilter, setCurrencyFilter] = useState<string>('all');
  const [customDateRange, setCustomDateRange] = useState<{ from?: Date; to?: Date }>({});
  
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadData = async () => {
      if (!token) {
        setError('Неправильная ссылка');
        setLoading(false);
        return;
      }

      try {
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

        // Load categories for this owner
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*')
          .eq('user_id', linkData.owner_user_id)
          .order('order', { ascending: true });

        if (categoriesError) {
          console.error('Categories error:', categoriesError);
        }
        setCategories(categoriesData || []);

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

  // Filter transactions based on all filter criteria
  const filteredTransactions = allTransactions.filter(t => {
    // Apply type filter
    if (typeFilter !== 'all' && t.type !== typeFilter) return false;

    // Apply category filter
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;

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

    // Apply text search
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const dateStr = format(new Date(t.date), 'dd.MM.yyyy');
      const amountStr = String(t.amount);
      const matches = (
        (t.description || '').toLowerCase().includes(q) ||
        (t.bankTitle || '').toLowerCase().includes(q) ||
        (t.departmentName || '').toLowerCase().includes(q) ||
        (t.bankSender || '').toLowerCase().includes(q) ||
        (t.bankRecipient || '').toLowerCase().includes(q) ||
        dateStr.includes(q) ||
        amountStr.includes(q) ||
        getCategoryName(t.category).toLowerCase().includes(q)
      );
      if (!matches) return false;
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

  const hasActiveFilters = searchText.trim() || customDateRange.from || customDateRange.to || 
    typeFilter !== 'all' || categoryFilter !== 'all' || currencyFilter !== 'all';

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
                : 'Используйте поиск и фильтры для просмотра транзакций'}
            </p>
          </div>

          {/* Search */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по описанию, сумме, дате, отделу..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="h-10 pl-8 text-sm"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="mb-6 space-y-3 p-4 bg-muted/30 rounded-lg border">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Type Filter */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Тип</label>
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
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Валюта</label>
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

              {/* Category Filter */}
              {categories.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Категория</label>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все категории</SelectItem>
                      {categories.map(cat => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Date Range */}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Период</label>
                <DateRangeFilter value={customDateRange} onChange={setCustomDateRange} />
              </div>
            </div>

            {/* Reset Filters */}
            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchText('');
                  setTypeFilter('all');
                  setCategoryFilter('all');
                  setCurrencyFilter('all');
                  setCustomDateRange({});
                }}
                className="text-xs text-muted-foreground"
              >
                Сбросить все фильтры
              </Button>
            )}
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
                  <p className="text-muted-foreground mb-2">Используйте фильтры для просмотра транзакций</p>
                  <p className="text-sm text-muted-foreground">
                    Введите поисковый запрос или установите фильтры выше
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
                              {transaction.departmentName || getCategoryName(transaction.category)}
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
