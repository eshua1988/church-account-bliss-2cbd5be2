import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Transaction, Currency, TransactionType, TransactionCategory } from '@/types/transaction';
import { DepartmentRule, findMatchingDepartment } from '@/lib/departmentRules';

interface DbTransaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  currency: string;
  category_id: string | null;
  description: string | null;
  date: string;
  issued_to: string | null;
  decision_number: string | null;
  amount_in_words: string | null;
  cashier_name: string | null;
  synced_to_sheets: boolean;
  created_at: string;
  updated_at: string;
  bank_sender: string | null;
  bank_recipient: string | null;
  bank_title: string | null;
  source: string | null;
  department_name: string | null;
  comment: string | null;
}

interface CurrencyTotal {
  currency: Currency;
  income: number;
  expense: number;
  balance: number;
  transactionCount: number;
}

const PAGE_SIZE = 200;

const cleanBankText = (value: string | null) =>
  (value || '')
    .replace(/(?:\d{4}\s*)?OD:\s*\d+\s+DO:\s*\d+\s+MOBILE-PAYMENT-C2C\b/gi, ' ')
    .replace(/OD:\s*[\d*]+\s+DO:\s*[\d*]+(?=\s|$|[.,;])/gi, ' ')
    .replace(/\bPRZELEW\s+NA\s+TELEFON\s+[\d*]+\.?/gi, ' ')
    .replace(/\b\d{4}\s+\d{10,}\s+MOBILE-PAYMENT-ATM-TX-CODE\b/gi, ' ')
    .replace(/(^|\s)(?:TRANSFER[-_\s]?(?:IN|OUT)|MOBILE-PAYMENT-C2C-EXTERNAL)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const mapDbToTransaction = (dbTx: DbTransaction): Transaction => ({
  id: dbTx.id,
  type: dbTx.type as TransactionType,
  category: (dbTx.category_id || 'other') as TransactionCategory,
  amount: Number(dbTx.amount),
  currency: dbTx.currency as Currency,
  description: cleanBankText(dbTx.bank_title) || cleanBankText(dbTx.description),
  date: new Date(dbTx.date),
  createdAt: new Date(dbTx.created_at),
  issuedTo: dbTx.issued_to || undefined,
  decisionNumber: dbTx.decision_number || undefined,
  amountInWords: dbTx.amount_in_words || undefined,
  cashierName: dbTx.cashier_name || undefined,
  bankTitle: cleanBankText(dbTx.bank_title) || undefined,
  bankSender: dbTx.bank_sender || undefined,
  bankRecipient: dbTx.bank_recipient || undefined,
  source: dbTx.source || undefined,
  departmentName: dbTx.department_name || undefined,
  comment: dbTx.comment || undefined,
});

export const useSupabaseTransactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [currencyTotals, setCurrencyTotals] = useState<CurrencyTotal[]>([]);
  const initializedRef = useRef(false);

  const fetchCurrencyTotals = useCallback(async () => {
    if (!user) {
      setCurrencyTotals([]);
      return [] as CurrencyTotal[];
    }

    const { data, error } = await (supabase as any).rpc('transaction_currency_totals');
    if (error) throw error;

    const totals = (data || []).map((row: any) => ({
      currency: row.currency as Currency,
      income: Number(row.income),
      expense: Number(row.expense),
      balance: Number(row.balance),
      transactionCount: Number(row.transaction_count),
    }));
    setCurrencyTotals(totals);
    return totals;
  }, [user]);

  // Only keep a bounded page in browser memory. Aggregates are calculated by PostgreSQL.
  const fetchTransactions = useCallback(async (append = false, offset = 0) => {
    if (!user) {
      setTransactions([]);
      setTotalCount(0);
      setCurrencyTotals([]);
      setLoading(false);
      return;
    }

    try {
      if (!initializedRef.current && !append) setLoading(true);
      if (append) setLoadingMore(true);
      const from = append ? offset : 0;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;

      const mappedTransactions = (data as DbTransaction[]).map(mapDbToTransaction);
      setTransactions(current => append ? [...current, ...mappedTransactions] : mappedTransactions);
      if (!append) {
        const totals = await fetchCurrencyTotals();
        setTotalCount(totals.reduce((sum, total) => sum + total.transactionCount, 0));
      }
      initializedRef.current = true;
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch transactions'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, fetchCurrencyTotals]);

  const loadMore = useCallback(
    () => fetchTransactions(true, transactions.length),
    [fetchTransactions, transactions.length],
  );

  // Subscribe to realtime changes + polling fallback
  useEffect(() => {
    if (!user) return;

    fetchTransactions();

    // Unique channel name per user prevents multi-device conflicts
    const channel = supabase
      .channel(`transactions-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchTransactions(false);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime: transactions subscribed');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('Realtime: transactions subscription issue, falling back to polling');
        }
      });

    // Polling fallback every 30s in case Realtime drops
    const poll = setInterval(() => fetchTransactions(false), 30_000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [user, fetchTransactions]);

  const addTransaction = useCallback(async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (!user) throw new Error('User not authenticated');

    let departmentName = transaction.departmentName || null;
    if (!departmentName) {
      const { data: rules } = await supabase
        .from('department_rules')
        .select('search_text, department_name, transaction_type')
        .eq('user_id', user.id);

      departmentName = findMatchingDepartment({
        type: transaction.type,
        description: transaction.description,
        bankTitle: transaction.bankTitle,
      }, (rules || []) as DepartmentRule[]);
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        user_id: user.id,
        type: transaction.type,
        amount: transaction.amount,
        currency: transaction.currency,
        category_id: transaction.category,
        description: transaction.description,
        date: transaction.date.toISOString().split('T')[0],
        issued_to: transaction.issuedTo,
        decision_number: transaction.decisionNumber,
        amount_in_words: transaction.amountInWords,
        cashier_name: transaction.cashierName,
        department_name: departmentName,
        bank_title: transaction.bankTitle || null,
        bank_sender: transaction.bankSender || null,
        bank_recipient: transaction.bankRecipient || null,
      })
      .select()
      .single();

    if (error) throw error;

    return mapDbToTransaction(data as DbTransaction);
  }, [user]);

  const deleteTransaction = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }, []);

  const updateTransaction = useCallback(async (id: string, updates: Partial<Transaction>) => {
    const dbUpdates: Record<string, unknown> = {};
    
    if (updates.type) dbUpdates.type = updates.type;
    if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
    if (updates.currency) dbUpdates.currency = updates.currency;
    if ('category' in updates) dbUpdates.category_id = updates.category || null;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.date) dbUpdates.date = updates.date.toISOString().split('T')[0];
    if ('issuedTo' in updates) dbUpdates.issued_to = updates.issuedTo || null;
    if ('decisionNumber' in updates) dbUpdates.decision_number = updates.decisionNumber || null;
    if ('amountInWords' in updates) dbUpdates.amount_in_words = updates.amountInWords || null;
    if ('cashierName' in updates) dbUpdates.cashier_name = updates.cashierName || null;
    if ('departmentName' in updates) dbUpdates.department_name = updates.departmentName || null;
    if ('comment' in updates) dbUpdates.comment = updates.comment || null;

    // Optimistic update: immediately update local state
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));

    const { error } = await supabase
      .from('transactions')
      .update(dbUpdates)
      .eq('id', id);

    if (error) {
      // Revert on error
      fetchTransactions(false);
      throw error;
    }
  }, [fetchTransactions]);

  const getTotalByCurrency = useCallback((currency: Currency, type?: TransactionType) => {
    return transactions
      .filter(t => t.currency === currency && (!type || t.type === type))
      .reduce((sum, t) => {
        return t.type === 'income' ? sum + t.amount : sum - t.amount;
      }, 0);
  }, [transactions]);

  const getBalanceByCurrency = useCallback((currency: Currency) => {
    const serverTotal = currencyTotals.find(total => total.currency === currency);
    if (serverTotal) {
      return {
        income: serverTotal.income,
        expense: serverTotal.expense,
        balance: serverTotal.balance,
      };
    }
    const income = transactions
      .filter(t => t.currency === currency && t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const expense = transactions
      .filter(t => t.currency === currency && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    
    return { income, expense, balance: income - expense };
  }, [transactions, currencyTotals]);

  const getRecentTransactions = useCallback((limit: number = 10) => {
    return [...transactions]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  }, [transactions]);

  const getTransactionsByCategory = useCallback((type: TransactionType) => {
    return transactions
      .filter(t => t.type === type)
      .reduce((acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.amount;
        return acc;
      }, {} as Record<string, number>);
  }, [transactions]);

  const getMonthlyData = useCallback((currency: Currency) => {
    const monthlyData: { month: string; income: number; expense: number; balance: number }[] = [];
    
    const filtered = transactions.filter(t => t.currency === currency);
    const months = new Set(filtered.map(t => {
      const d = new Date(t.date);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }));
    
    Array.from(months).sort().forEach(month => {
      const monthTransactions = filtered.filter(t => {
        const d = new Date(t.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month;
      });
      
      const income = monthTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + t.amount, 0);
      
      const expense = monthTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + t.amount, 0);
      
      monthlyData.push({
        month,
        income,
        expense,
        balance: income - expense,
      });
    });
    
    return monthlyData;
  }, [transactions]);

  return {
    transactions,
    loading,
    loadingMore,
    error,
    totalCount,
    hasMore: transactions.length < totalCount,
    loadMore,
    availableCurrencies: currencyTotals.map(total => total.currency),
    addTransaction,
    deleteTransaction,
    updateTransaction,
    getTotalByCurrency,
    getBalanceByCurrency,
    getRecentTransactions,
    getTransactionsByCategory,
    getMonthlyData,
    refetch: fetchTransactions,
  };
};
