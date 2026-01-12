import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Transaction, Currency, TransactionType, TransactionCategory } from '@/types/transaction';

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
}

const mapDbToTransaction = (dbTx: DbTransaction): Transaction => ({
  id: dbTx.id,
  type: dbTx.type as TransactionType,
  category: (dbTx.category_id || 'other') as TransactionCategory,
  amount: Number(dbTx.amount),
  currency: dbTx.currency as Currency,
  description: dbTx.description || '',
  date: new Date(dbTx.date),
  createdAt: new Date(dbTx.created_at),
  issuedTo: dbTx.issued_to || undefined,
  decisionNumber: dbTx.decision_number || undefined,
  amountInWords: dbTx.amount_in_words || undefined,
  cashierName: dbTx.cashier_name || undefined,
});

export const useSupabaseTransactions = () => {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    if (!user) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });

      if (error) throw error;

      const mappedTransactions = (data as DbTransaction[]).map(mapDbToTransaction);
      setTransactions(mappedTransactions);
    } catch (err) {
      console.error('Error fetching transactions:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch transactions'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!user) return;

    fetchTransactions();

    const channel = supabase
      .channel('transactions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'transactions',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          // Refetch on any change
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchTransactions]);

  const addTransaction = useCallback(async (transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    if (!user) throw new Error('User not authenticated');

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
    if (updates.category) dbUpdates.category_id = updates.category;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.date) dbUpdates.date = updates.date.toISOString().split('T')[0];
    if (updates.issuedTo !== undefined) dbUpdates.issued_to = updates.issuedTo;
    if (updates.decisionNumber !== undefined) dbUpdates.decision_number = updates.decisionNumber;
    if (updates.amountInWords !== undefined) dbUpdates.amount_in_words = updates.amountInWords;
    if (updates.cashierName !== undefined) dbUpdates.cashier_name = updates.cashierName;

    const { error } = await supabase
      .from('transactions')
      .update(dbUpdates)
      .eq('id', id);

    if (error) throw error;
  }, []);

  const getTotalByCurrency = useCallback((currency: Currency, type?: TransactionType) => {
    return transactions
      .filter(t => t.currency === currency && (!type || t.type === type))
      .reduce((sum, t) => {
        return t.type === 'income' ? sum + t.amount : sum - t.amount;
      }, 0);
  }, [transactions]);

  const getBalanceByCurrency = useCallback((currency: Currency) => {
    const income = transactions
      .filter(t => t.currency === currency && t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const expense = transactions
      .filter(t => t.currency === currency && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    
    return { income, expense, balance: income - expense };
  }, [transactions]);

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
    error,
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
