import { useState, useCallback } from 'react';
import { Transaction, Currency, TransactionType } from '@/types/transaction';

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

export const useTransactions = () => {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);

  const addTransaction = useCallback((transaction: Omit<Transaction, 'id' | 'createdAt'>) => {
    const newTransaction: Transaction = {
      ...transaction,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    
    setTransactions(prev => {
      const updated = [newTransaction, ...prev];
      saveTransactions(updated);
      return updated;
    });
    
    return newTransaction;
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions(prev => {
      const updated = prev.filter(t => t.id !== id);
      saveTransactions(updated);
      return updated;
    });
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

  return {
    transactions,
    addTransaction,
    deleteTransaction,
    getTotalByCurrency,
    getBalanceByCurrency,
    getRecentTransactions,
  };
};
