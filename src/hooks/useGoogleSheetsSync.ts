import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Transaction } from '@/types/transaction';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_SHEET_RANGE = "'Data app'!A:I";
const AUTO_SYNC_KEY = 'google_sheets_auto_sync';
const AUTO_DELETE_CHECK_KEY = 'google_sheets_auto_delete_check';
const DELETE_CHECK_INTERVAL = 60000;

interface UseGoogleSheetsSyncProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
  onDeleteTransaction?: (id: string) => Promise<void>;
}

export const useGoogleSheetsSync = ({
  transactions,
  getCategoryName,
  onDeleteTransaction,
}: UseGoogleSheetsSyncProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetRange, setSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // Load user settings from profiles table
  useEffect(() => {
    const loadUserSettings = async () => {
      if (!user) return;
      
      setIsLoadingSettings(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('spreadsheet_id, sheet_range')
          .eq('user_id', user.id)
          .single();
        
        if (error && error.code !== 'PGRST116') {
          console.error('Error loading settings:', error);
        }
        
        if (data) {
          setSpreadsheetId(data.spreadsheet_id || '');
          setSheetRange(data.sheet_range || DEFAULT_SHEET_RANGE);
        }
      } catch (error) {
        console.error('Error loading user settings:', error);
      } finally {
        setIsLoadingSettings(false);
      }
    };

    loadUserSettings();
  }, [user]);

  const syncToSheets = useCallback(async (txs: Transaction[]) => {
    if (!spreadsheetId) {
      toast({
        title: 'Настройте таблицу',
        description: 'Укажите ID таблицы в настройках',
        variant: 'destructive',
      });
      return false;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: 'Ошибка авторизации',
        description: 'Пожалуйста, войдите в систему',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const headers = ['ID', 'Date', 'Type', 'Category', 'Amount', 'Currency', 'Description', 'Issued To', 'DELETE'];
      
      const sortedTxs = [...txs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      const rows = sortedTxs.map(tx => [
        tx.id,
        new Date(tx.date).toLocaleDateString('pl-PL'),
        tx.type,
        getCategoryName(tx.category),
        tx.amount.toString(),
        tx.currency,
        tx.description || '',
        tx.type === 'expense' ? (tx.issuedTo || '') : '',
        '',
      ]);

      const values = [headers, ...rows];

      const { error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'write',
          spreadsheetId: spreadsheetId,
          range: sheetRange,
          values,
        },
      });

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: 'Ошибка синхронизации',
        description: error instanceof Error ? error.message : 'Проверьте настройки таблицы',
        variant: 'destructive',
      });
      return false;
    }
  }, [getCategoryName, toast, spreadsheetId, sheetRange]);

  const handleExport = useCallback(async () => {
    if (!spreadsheetId) {
      toast({
        title: 'Настройте таблицу',
        description: 'Укажите ID Google таблицы в настройках',
        variant: 'destructive',
      });
      return;
    }
    
    setIsExporting(true);
    const success = await syncToSheets(transactions);
    setIsExporting(false);
    
    if (success) {
      toast({
        title: 'Экспорт завершен',
        description: `Экспортировано ${transactions.length} транзакций`,
      });
    }
  }, [spreadsheetId, syncToSheets, transactions, toast]);

  const handleImport = useCallback(async () => {
    if (!spreadsheetId) {
      toast({
        title: 'Настройте таблицу',
        description: 'Укажите ID Google таблицы в настройках',
        variant: 'destructive',
      });
      return;
    }
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: 'Ошибка авторизации',
        description: 'Пожалуйста, войдите в систему',
        variant: 'destructive',
      });
      return;
    }
    
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'read',
          spreadsheetId: spreadsheetId,
          range: sheetRange,
        },
      });

      if (error) throw error;

      const rows = data?.values || [];
      if (rows.length > 1 && onDeleteTransaction) {
        let deletedCount = 0;
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const transactionId = row[0];
          const deleteMarker = row[8]?.toString().trim().toLowerCase();
          
          if (deleteMarker && deleteMarker !== '' && transactionId) {
            try {
              await onDeleteTransaction(transactionId);
              deletedCount++;
            } catch (err) {
              console.error(`Failed to delete transaction ${transactionId}:`, err);
            }
          }
        }
        
        if (deletedCount > 0) {
          toast({
            title: 'Удаление завершено',
            description: `Удалено ${deletedCount} транзакций`,
          });
          
          setTimeout(() => {
            syncToSheets(transactions.filter(t => 
              !rows.some((row: string[]) => row[0] === t.id && row[8]?.toString().trim())
            ));
          }, 500);
          
          return;
        }
      }

      toast({
        title: 'Импорт завершен',
        description: `Получено ${rows.length - 1} строк данных`,
      });
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Ошибка импорта',
        description: error instanceof Error ? error.message : 'Неизвестная ошибка',
        variant: 'destructive',
      });
    } finally {
      setIsImporting(false);
    }
  }, [spreadsheetId, sheetRange, onDeleteTransaction, syncToSheets, transactions, toast]);

  return {
    isExporting,
    isImporting,
    isLoadingSettings,
    spreadsheetId,
    handleExport,
    handleImport,
  };
};
