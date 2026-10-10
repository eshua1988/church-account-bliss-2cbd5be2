import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface PdfArchiveEntry {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  currency: string;
  category_id: string | null;
  department_name: string | null;
  basis: string | null;
  issued_to: string | null;
  document_date: string;
  created_at: string;
}

export const usePdfArchiveEntries = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<PdfArchiveEntry[]>([]);

  const fetchEntries = useCallback(async () => {
    if (!user) {
      setEntries([]);
      return;
    }
    const { data, error } = await (supabase as any)
      .from('pdf_archive_entries')
      .select('id, type, amount, currency, category_id, department_name, basis, issued_to, document_date, created_at')
      .eq('user_id', user.id)
      .order('document_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching PDF archive entries:', error);
      return;
    }
    setEntries((data || []).map((entry: any) => ({ ...entry, amount: Number(entry.amount) })));
  }, [user]);

  useEffect(() => {
    fetchEntries();
    if (!user) return;
    const channel = supabase
      .channel(`pdf-archive-entries-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pdf_archive_entries', filter: `user_id=eq.${user.id}` }, fetchEntries)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchEntries]);

  return { entries, refetchPdfArchiveEntries: fetchEntries };
};
