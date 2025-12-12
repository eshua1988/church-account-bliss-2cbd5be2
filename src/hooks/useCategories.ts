import { useState, useCallback } from 'react';
import { TransactionType } from '@/types/transaction';

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
}

const DEFAULT_INCOME_CATEGORIES: Category[] = [
  { id: 'tithe', name: 'Десятина', type: 'income' },
  { id: 'offering', name: 'Пожертвование', type: 'income' },
  { id: 'donation', name: 'Дар', type: 'income' },
  { id: 'building_fund', name: 'Фонд строительства', type: 'income' },
  { id: 'missions_income', name: 'Миссии', type: 'income' },
  { id: 'other_income', name: 'Прочее', type: 'income' },
];

const DEFAULT_EXPENSE_CATEGORIES: Category[] = [
  { id: 'salaries', name: 'Зарплаты', type: 'expense' },
  { id: 'utilities', name: 'Коммунальные услуги', type: 'expense' },
  { id: 'maintenance', name: 'Обслуживание', type: 'expense' },
  { id: 'supplies', name: 'Расходные материалы', type: 'expense' },
  { id: 'charity', name: 'Благотворительность', type: 'expense' },
  { id: 'missions_expense', name: 'Миссии', type: 'expense' },
  { id: 'other_expense', name: 'Прочее', type: 'expense' },
];

const STORAGE_KEY = 'church_categories';

const loadCategories = (): Category[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load categories:', e);
  }
  return [...DEFAULT_INCOME_CATEGORIES, ...DEFAULT_EXPENSE_CATEGORIES];
};

const saveCategories = (categories: Category[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
  } catch (e) {
    console.error('Failed to save categories:', e);
  }
};

export const useCategories = () => {
  const [categories, setCategories] = useState<Category[]>(loadCategories);

  const addCategory = useCallback((name: string, type: TransactionType) => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;

    const newCategory: Category = {
      id: crypto.randomUUID(),
      name: trimmedName,
      type,
    };

    setCategories(prev => {
      const updated = [...prev, newCategory];
      saveCategories(updated);
      return updated;
    });

    return newCategory;
  }, []);

  const deleteCategory = useCallback((id: string) => {
    setCategories(prev => {
      const updated = prev.filter(c => c.id !== id);
      saveCategories(updated);
      return updated;
    });
  }, []);

  const getIncomeCategories = useCallback(() => {
    return categories.filter(c => c.type === 'income');
  }, [categories]);

  const getExpenseCategories = useCallback(() => {
    return categories.filter(c => c.type === 'expense');
  }, [categories]);

  const getCategoryName = useCallback((id: string) => {
    return categories.find(c => c.id === id)?.name || 'Неизвестно';
  }, [categories]);

  return {
    categories,
    addCategory,
    deleteCategory,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
  };
};
