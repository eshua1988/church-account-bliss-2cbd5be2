import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { TransactionType } from '@/types/transaction';

export interface Category {
  id: string;
  name: string;
  type: TransactionType;
  sortOrder: number;
}

interface DbCategory {
  id: string;
  user_id: string;
  name: string;
  type: string;
  sort_order: number;
  created_at: string;
}

const DEFAULT_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Десятина', type: 'income', sortOrder: 0 },
  { name: 'Пожертвование', type: 'income', sortOrder: 1 },
  { name: 'Дар', type: 'income', sortOrder: 2 },
  { name: 'Фонд строительства', type: 'income', sortOrder: 3 },
  { name: 'Миссии (доход)', type: 'income', sortOrder: 4 },
  { name: 'Прочее (доход)', type: 'income', sortOrder: 5 },
  { name: 'Зарплаты', type: 'expense', sortOrder: 0 },
  { name: 'Коммунальные услуги', type: 'expense', sortOrder: 1 },
  { name: 'Обслуживание', type: 'expense', sortOrder: 2 },
  { name: 'Расходные материалы', type: 'expense', sortOrder: 3 },
  { name: 'Благотворительность', type: 'expense', sortOrder: 4 },
  { name: 'Миссии (расход)', type: 'expense', sortOrder: 5 },
  { name: 'Прочее (расход)', type: 'expense', sortOrder: 6 },
];

const mapDbToCategory = (dbCat: DbCategory): Category => ({
  id: dbCat.id,
  name: dbCat.name,
  type: dbCat.type as TransactionType,
  sortOrder: dbCat.sort_order,
});

export const useSupabaseCategories = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    if (!user) {
      setCategories([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      // If no categories exist, create defaults
      if (!data || data.length === 0) {
        const defaultCats = DEFAULT_CATEGORIES.map(cat => ({
          user_id: user.id,
          name: cat.name,
          type: cat.type,
          sort_order: cat.sortOrder,
        }));

        const { data: newData, error: insertError } = await supabase
          .from('categories')
          .insert(defaultCats)
          .select();

        if (insertError) throw insertError;

        setCategories((newData as DbCategory[]).map(mapDbToCategory));
      } else {
        setCategories((data as DbCategory[]).map(mapDbToCategory));
      }
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const addCategory = useCallback(async (name: string, type: TransactionType) => {
    if (!user) throw new Error('User not authenticated');

    const trimmedName = name.trim();
    if (!trimmedName) return null;

    const maxOrder = categories
      .filter(c => c.type === type)
      .reduce((max, c) => Math.max(max, c.sortOrder), -1);

    const { data, error } = await supabase
      .from('categories')
      .insert({
        user_id: user.id,
        name: trimmedName,
        type,
        sort_order: maxOrder + 1,
      })
      .select()
      .single();

    if (error) throw error;

    const newCategory = mapDbToCategory(data as DbCategory);
    setCategories(prev => [...prev, newCategory]);
    
    return newCategory;
  }, [user, categories]);

  const deleteCategory = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    setCategories(prev => prev.filter(c => c.id !== id));
  }, []);

  const updateCategory = useCallback(async (id: string, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const { error } = await supabase
      .from('categories')
      .update({ name: trimmedName })
      .eq('id', id);

    if (error) throw error;

    setCategories(prev => prev.map(c => 
      c.id === id ? { ...c, name: trimmedName } : c
    ));
  }, []);

  const reorderCategories = useCallback(async (type: TransactionType, fromIndex: number, toIndex: number) => {
    const typeCategories = categories.filter(c => c.type === type);
    const otherCategories = categories.filter(c => c.type !== type);
    
    const [movedItem] = typeCategories.splice(fromIndex, 1);
    typeCategories.splice(toIndex, 0, movedItem);
    
    // Update sort orders
    const updates = typeCategories.map((cat, idx) => ({
      id: cat.id,
      sort_order: idx,
    }));

    // Update in database
    for (const update of updates) {
      await supabase
        .from('categories')
        .update({ sort_order: update.sort_order })
        .eq('id', update.id);
    }

    setCategories([...otherCategories, ...typeCategories.map((c, idx) => ({ ...c, sortOrder: idx }))]);
  }, [categories]);

  const getIncomeCategories = useCallback(() => {
    return categories
      .filter(c => c.type === 'income')
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories]);

  const getExpenseCategories = useCallback(() => {
    return categories
      .filter(c => c.type === 'expense')
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories]);

  const getCategoryName = useCallback((id: string) => {
    return categories.find(c => c.id === id)?.name || 'Неизвестно';
  }, [categories]);

  return {
    categories,
    loading,
    addCategory,
    deleteCategory,
    updateCategory,
    reorderCategories,
    getIncomeCategories,
    getExpenseCategories,
    getCategoryName,
    refetch: fetchCategories,
  };
};
