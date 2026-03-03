import { useState, useEffect, useRef, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Transaction } from '@/types/transaction';
import { useAuth } from '@/contexts/AuthContext';

const DEFAULT_SHEET_RANGE = "A:Z"; // Wide range, sheet name auto-resolved by Edge Function
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
          .maybeSingle();
        
        if (error) {
          console.error('Error loading settings:', error);
        }
        
        if (data) {
          setSpreadsheetId(data.spreadsheet_id || '');
          setSheetRange(data.sheet_range || DEFAULT_SHEET_RANGE);
        } else {
          // Profile doesn't exist yet — create it
          await supabase.from('profiles').upsert(
            { user_id: user.id, email: user.email ?? '', display_name: user.email ?? '' },
            { onConflict: 'user_id' }
          );
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
      
      // Headers: ID, Date, Income, [Category columns...]
      const headers = ['ID', 'Date', 'Income', ...sortedCategories.map(([, name]) => name)];
      
      // Group transactions by date (date string key)
      const dateMap = new Map<string, Transaction[]>();
      for (const tx of txs) {
        const dateKey = new Date(tx.date).toLocaleDateString('pl-PL');
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
        dateMap.get(dateKey)!.push(tx);
      }

      // Sort dates descending
      const sortedDates = Array.from(dateMap.keys()).sort((a, b) => {
        const parse = (s: string) => {
          const [d, m, y] = s.split('.');
          return new Date(+y, +m - 1, +d).getTime();
        };
        return parse(b) - parse(a);
      });

      // Build rows: one row per transaction, date shown only in first row of each date group
      const rows: string[][] = [];
      const notes: { row: number; col: number; note: string }[] = [];

      sortedDates.forEach((dateKey) => {
        const dayTxs = dateMap.get(dateKey)!;
        // Newest transactions first (top)
        dayTxs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        dayTxs.forEach((tx, txIndex) => {
          let col: number;
          if (tx.type === 'income') {
            col = 2;
          } else {
            const categoryIndex = sortedCategories.findIndex(([id]) => id === tx.category);
            col = categoryIndex !== -1 ? 3 + categoryIndex : -1;
          }

          const rowIndex = rows.length;
          const row: string[] = new Array(headers.length).fill('');
          row[0] = tx.id;
          // Date only in the first row of this date group
          row[1] = txIndex === 0 ? dateKey : '';

          if (col !== -1) {
            row[col] = `${tx.amount} ${tx.currency}`;

            // Add note with description/issuedTo
            const noteParts: string[] = [];
            if (tx.description) noteParts.push(`Описание: ${tx.description}`);
            if (tx.type === 'expense' && tx.issuedTo) noteParts.push(`Кому: ${tx.issuedTo}`);
            if (noteParts.length > 0) {
              notes.push({ row: rowIndex + 1, col, note: noteParts.join('\n') });
            }
          }

          rows.push(row);
        });
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
            // Check if delete value is a simple delete marker (д, Д, d, D)
            const isSimpleDeleteMarker = /^[дДdD]$/i.test(deleteValue);
            
            if (isSimpleDeleteMarker) {
              // Delete the current row's transaction
              if (transactionIdInRow && isUUID(transactionIdInRow)) {
                idsToDelete.add(transactionIdInRow);
              }
            } else {
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
