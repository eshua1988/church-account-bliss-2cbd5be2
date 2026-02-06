import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Transaction } from '@/types/transaction';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_SHEET_RANGE = "'Data app'!A:Z"; // Wide range to accommodate dynamic category columns
const AUTO_SYNC_KEY = 'google_sheets_auto_sync';
const AUTO_DELETE_CHECK_KEY = 'google_sheets_auto_delete_check';
const DELETE_CHECK_INTERVAL = 60000;

interface Category {
  id: string;
  name: string;
  type: string;
}

interface UseGoogleSheetsSyncProps {
  transactions: Transaction[];
  onDeleteTransaction?: (id: string) => Promise<void>;
  expenseCategories?: Category[];
}

export const useGoogleSheetsSync = ({
  transactions,
  onDeleteTransaction,
  expenseCategories = [],
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
      // Use all expense categories from database, sorted alphabetically
      const sortedCategories = expenseCategories
        .filter(cat => cat.type === 'expense')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(cat => [cat.id, cat.name] as [string, string]);
      
      // Headers: ID, Date, Income, [Category columns...], DELETE
      const headers = ['ID', 'Date', 'Income', ...sortedCategories.map(([, name]) => name), 'DELETE'];
      
      const sortedTxs = [...txs].sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        if (dateA !== dateB) return dateB - dateA;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      
      // Create rows with amounts in appropriate columns
      const rows = sortedTxs.map(tx => {
        const row: string[] = new Array(headers.length).fill('');
        row[0] = tx.id; // ID
        row[1] = new Date(tx.date).toLocaleDateString('pl-PL'); // Date
        
        if (tx.type === 'income') {
          row[2] = `${tx.amount} ${tx.currency}`; // Income column
        } else {
          // Find the category column index
          const categoryIndex = sortedCategories.findIndex(([id]) => id === tx.category);
          if (categoryIndex !== -1) {
            row[3 + categoryIndex] = `${tx.amount} ${tx.currency}`; // Category column
          }
        }
        
        row[headers.length - 1] = ''; // DELETE column (last)
        return row;
      });

      // Create notes for cells with amounts (Description, Issued To, Date)
      const notes: { row: number; col: number; note: string }[] = [];
      sortedTxs.forEach((tx, index) => {
        const noteParts: string[] = [];
        if (tx.description) noteParts.push(`Описание: ${tx.description}`);
        if (tx.type === 'expense' && tx.issuedTo) noteParts.push(`Кому: ${tx.issuedTo}`);
        noteParts.push(`Дата: ${new Date(tx.date).toLocaleDateString('pl-PL')}`);
        
        if (noteParts.length > 0) {
          let col: number;
          if (tx.type === 'income') {
            col = 2; // Income column
          } else {
            const categoryIndex = sortedCategories.findIndex(([id]) => id === tx.category);
            col = categoryIndex !== -1 ? 3 + categoryIndex : -1;
          }
          
          if (col !== -1) {
            notes.push({
              row: index + 1, // +1 for header row
              col,
              note: noteParts.join('\n'),
            });
          }
        }
      });

      const values = [headers, ...rows];

      const { error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'write',
          spreadsheetId: spreadsheetId,
          range: sheetRange,
          values,
          notes,
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
  }, [expenseCategories, toast, spreadsheetId, sheetRange]);

  const handleExport = useCallback(async () => {
    if (!spreadsheetId) {
      toast({
        title: 'Настройте таблицу',
        description: 'Укажите ID Google таблицы в настройках',
        variant: 'destructive',
      });
      return false;
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
    return success;
  }, [spreadsheetId, syncToSheets, transactions, toast]);

  // UUID pattern for transaction IDs
  const isUUID = (str: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str.trim());
  };

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
        // Find DELETE column dynamically from headers
        const headers = rows[0] as string[];
        const deleteColumnIndex = headers.findIndex(h => h === 'DELETE');
        
        if (deleteColumnIndex === -1) {
          console.warn('DELETE column not found in headers');
          return;
        }
        
        // Collect all transaction IDs to delete
        const idsToDelete: Set<string> = new Set();
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const transactionIdInRow = row[0]; // ID column
          const deleteValue = row[deleteColumnIndex]?.toString().trim();
          
          if (deleteValue && deleteValue !== '') {
            // Check if delete value contains UUIDs (could be semicolon-separated from array formula)
            // Also handle values like "id1;id2;id3" from array formulas
            const potentialIds = deleteValue.split(/[;,\n]/);
            
            for (const potentialId of potentialIds) {
              const trimmedId = potentialId.trim();
              if (isUUID(trimmedId)) {
                // This is a transaction ID - delete this specific transaction
                idsToDelete.add(trimmedId);
              }
            }
            
            // If no valid UUIDs found in the delete value, but there's content,
            // treat it as a marker to delete the current row's transaction
            if (idsToDelete.size === 0 || !potentialIds.some(id => isUUID(id.trim()))) {
              if (transactionIdInRow && isUUID(transactionIdInRow)) {
                idsToDelete.add(transactionIdInRow);
              }
            }
          }
        }
        
        let deletedCount = 0;
        
        for (const idToDelete of idsToDelete) {
          try {
            await onDeleteTransaction(idToDelete);
            deletedCount++;
          } catch (err) {
            console.error(`Failed to delete transaction ${idToDelete}:`, err);
          }
        }
        
        if (deletedCount > 0) {
          toast({
            title: 'Удаление завершено',
            description: `Удалено ${deletedCount} транзакций`,
          });
          
          // Resync after deletion to update the sheet
          setTimeout(() => {
            const remainingTransactions = transactions.filter(t => !idsToDelete.has(t.id));
            syncToSheets(remainingTransactions);
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

  const handleSync = useCallback(async () => {
    if (!spreadsheetId) {
      toast({
        title: 'Настройте таблицу',
        description: 'Укажите ID Google таблицы в настройках',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'Синхронизация',
      description: 'Начинаем синхронизацию с Google Sheets...',
    });

    // First export, then import
    const exportSuccess = await handleExport();
    if (exportSuccess) {
      await handleImport();
    }
  }, [spreadsheetId, handleExport, handleImport, toast]);

  return {
    isExporting,
    isImporting,
    isSyncing: isExporting || isImporting,
    isLoadingSettings,
    spreadsheetId,
    handleExport,
    handleImport,
    handleSync,
  };
};
