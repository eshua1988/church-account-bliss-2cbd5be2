import { useState, useCallback, useEffect } from 'react';
import { Transaction, Currency, TransactionType } from '@/types/transaction';
import { useUndoRedo } from './useUndoRedo';

const STORAGE_KEY = 'church_transactions';

const loadTransactions = (): Transaction[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return parsed.map((t: any) => ({
        ...t,
        date: new Date(t.date),
        createdAt: new Date(t.createdAt),
      }));
    }
  } catch (e) {
    console.error('Failed to load transactions:', e);
  }
  return [];
};

const saveTransactions = (transactions: Transaction[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
  } catch (e) {
    console.error('Failed to save transactions:', e);
  }
};

export const useTransactionsWithHistory = () => {
  const {
    state: transactions,
    setState: setTransactions,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useUndoRedo<Transaction[]>(loadTransactions());

  // Save to localStorage whenever transactions change
  useEffect(() => {
    saveTransactions(transactions);
  }, [transactions]);

  const addTransaction = useCallback((transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    const newTransaction: Transaction = {
      ...transaction,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    
    setTransactions(prev => [newTransaction, ...prev]);
    
    return newTransaction;
  }, [setTransactions]);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  }, [setTransactions]);

  const updateTransaction = useCallback((id: string, updates: Partial<Omit<Transaction, 'id' | 'createdAt'>>) => {
    setTransactions(prev => 
      prev.map(t => t.id === id ? { ...t, ...updates } : t)
    );
  }, [setTransactions]);

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

  const getTransactionsByCategory = useCallback((type?: TransactionType) => {
    const filtered = type 
      ? transactions.filter(t => t.type === type)
      : transactions;
    
    const grouped = filtered.reduce((acc, t) => {
      const key = t.category;
      if (!acc[key]) {
        acc[key] = 0;
      }
      acc[key] += t.amount;
      return acc;
    }, {} as Record<string, number>);

    return grouped;
  }, [transactions]);

  const getMonthlyData = useCallback((currency?: Currency) => {
    const filtered = currency 
      ? transactions.filter(t => t.currency === currency)
      : transactions;

    const monthly = filtered.reduce((acc, t) => {
      const monthKey = `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!acc[monthKey]) {
        acc[monthKey] = { income: 0, expense: 0 };
      }
      
      if (t.type === 'income') {
        acc[monthKey].income += t.amount;
      } else {
        acc[monthKey].expense += t.amount;
      }
      
      return acc;
    }, {} as Record<string, { income: number; expense: number }>);

    return Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({
        month,
        ...data,
        balance: data.income - data.expense,
      }));
  }, [transactions]);

  return {
    transactions,
    addTransaction,
    deleteTransaction,
    updateTransaction,
    getTotalByCurrency,
    getBalanceByCurrency,
    getRecentTransactions,
    getTransactionsByCategory,
    getMonthlyData,
    undo,
    redo,
    canUndo,
    canRedo,
  };
};
