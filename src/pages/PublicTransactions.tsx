import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Search, ChevronDown, ChevronUp, TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Toaster } from '@/components/ui/toaster';
import { Currency, CURRENCY_SYMBOLS, Transaction } from '@/types/transaction';

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
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchText, setSearchText] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const loadData = async () => {
      if (!token) {
        setError('Неправильная ссылка');
        setLoading(false);
        return;
      }

      try {
        // Validate token via secure edge function
        const { data: validationData, error: validationError } = await supabase.functions.invoke('validate-payout-token', {
          body: { token }
        });

        if (validationError) throw validationError;

        if (!validationData?.valid) {
          setError(validationData?.error || 'Ссылка неактивна или не существует');
          setLoading(false);
          return;
        }

        // Get shared link and owner user ID
        const { data: linkData, error: linkError } = await supabase
          .from('shared_transaction_links')
          .select('*')
          .eq('token', token)
          .eq('is_active', true)
          .single();

        if (linkError) {
          setError('Ссылка не найдена');
          setLoading(false);
          return;
        }

        setLinkData(linkData);

        // Load categories
        const { data: categoriesData, error: categoriesError } = await supabase
          .from('categories')
          .select('*')
          .eq('user_id', linkData.owner_user_id)
          .order('order', { ascending: true });

        if (categoriesError) throw categoriesError;
        setCategories(categoriesData || []);

        // Load transactions for the link owner
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', linkData.owner_user_id)
          .order('date', { ascending: false });

        if (transactionsError) throw transactionsError;
        setTransactions(transactionsData || []);
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

  const filteredTransactions = transactions.filter(t => {
    if (!searchText.trim()) return true;
    const q = searchText.trim().toLowerCase();
    const dateStr = format(new Date(t.date), 'dd.MM.yyyy');
    const amountStr = String(t.amount);
    return (
      (t.description || '').toLowerCase().includes(q) ||
      (t.bankTitle || '').toLowerCase().includes(q) ||
      (t.departmentName || '').toLowerCase().includes(q) ||
      (t.bankSender || '').toLowerCase().includes(q) ||
      (t.bankRecipient || '').toLowerCase().includes(q) ||
      dateStr.includes(q) ||
      amountStr.includes(q) ||
      getCategoryName(t.category).toLowerCase().includes(q)
    );
  });

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
              {filteredTransactions.length} транзакций
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

          {/* Filtered Totals */}
          {searchText.trim() && (
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

          {/* Transactions */}
          {filteredTransactions.length === 0 ? (
            <Card>
              <CardContent className="py-12">
                <p className="text-center text-muted-foreground">
                  {searchText.trim() ? 'Нет результатов поиска' : 'Нет транзакций'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredTransactions.map((transaction, index) => {
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
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
                                <p className="text-muted-foreground text-xs">Отдел</p>
                                <p className="font-medium">{transaction.departmentName}</p>
                              </div>
                            )}
                            {transaction.bankSender && (
                              <div>
                                <p className="text-muted-foreground text-xs">От кого</p>
                                <p className="font-medium">{transaction.bankSender}</p>
                              </div>
                            )}
                            {transaction.bankRecipient && (
                              <div>
                                <p className="text-muted-foreground text-xs">Кому</p>
                                <p className="font-medium">{transaction.bankRecipient}</p>
                              </div>
                            )}
                            {transaction.bankTitle && (
                              <div className="sm:col-span-2">
                                <p className="text-muted-foreground text-xs">Назначение</p>
                                <p className="font-medium">{transaction.bankTitle}</p>
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
          <div className="mt-6 text-center text-xs text-muted-foreground">
            <p>Показано транзакций: {filteredTransactions.length}</p>
          </div>
        </div>
      </div>
      <Toaster />
    </>
  );
};

export default PublicTransactions;
