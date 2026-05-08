import { useState, useEffect, useCallback, useRef } from 'react';
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

const normalizeCategoryName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const categoryKey = (category: Pick<Category, 'name' | 'type'>) =>
  `${category.type}:${normalizeCategoryName(category.name)}`;

const dedupeCategories = (items: Category[]) => {
  const seen = new Set<string>();
  return items.filter(category => {
    const key = categoryKey(category);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const useSupabaseCategories = () => {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  const removeDuplicateCategories = useCallback(async (items: Category[]) => {
    if (!user) return items;

    const grouped = new Map<string, Category[]>();
    for (const category of items) {
      const key = categoryKey(category);
      grouped.set(key, [...(grouped.get(key) || []), category]);
    }

    const cleaned: Category[] = [];

    for (const group of grouped.values()) {
      const sorted = [...group].sort((a, b) => a.sortOrder - b.sortOrder);
      const [keeper, ...duplicates] = sorted;
      cleaned.push(keeper);

      for (const duplicate of duplicates) {
        await supabase
          .from('transactions')
          .update({ category_id: keeper.id })
          .eq('user_id', user.id)
          .eq('category_id', duplicate.id);

        await supabase
          .from('categories')
          .delete()
          .eq('user_id', user.id)
          .eq('id', duplicate.id);
      }
    }

    return cleaned.sort((a, b) =>
      a.type === b.type
        ? a.sortOrder - b.sortOrder
        : a.type.localeCompare(b.type)
    );
  }, [user]);

  const fetchCategories = useCallback(async () => {
    if (!user) {
      setCategories([]);
      setLoading(false);
      return;
    }

    try {
      // Show loading spinner only on first load, background refreshes are silent
      if (!initializedRef.current) setLoading(true);
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

        setCategories(dedupeCategories((newData as DbCategory[]).map(mapDbToCategory)));
      } else {
        const mapped = (data as DbCategory[]).map(mapDbToCategory);
        setCategories(await removeDuplicateCategories(mapped));
      }
      initializedRef.current = true;
    } catch (err) {
      console.error('Error fetching categories:', err);
    } finally {
      setLoading(false);
    }
  }, [user, removeDuplicateCategories]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const addCategory = useCallback(async (name: string, type: TransactionType) => {
    if (!user) throw new Error('User not authenticated');

    const trimmedName = name.trim();
    if (!trimmedName) return null;

    const existing = categories.find(
      c => c.type === type && normalizeCategoryName(c.name) === normalizeCategoryName(trimmedName)
    );
    if (existing) return existing;

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
    setCategories(prev => dedupeCategories([...prev, newCategory]));
    
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

    const current = categories.find(c => c.id === id);
    if (
      current &&
      categories.some(c =>
        c.id !== id &&
        c.type === current.type &&
        normalizeCategoryName(c.name) === normalizeCategoryName(trimmedName)
      )
    ) {
      return;
    }

    const { error } = await supabase
      .from('categories')
      .update({ name: trimmedName })
      .eq('id', id);

    if (error) throw error;

    setCategories(prev => prev.map(c => 
      c.id === id ? { ...c, name: trimmedName } : c
    ));
  }, [categories]);

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
