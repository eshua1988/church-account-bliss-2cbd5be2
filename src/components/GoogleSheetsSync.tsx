import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Cloud, CloudOff, Settings, Save, ExternalLink, Table2, FileDown, Plus, Trash2 } from 'lucide-react';
import { Transaction } from '@/types/transaction';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DEFAULT_SHEET_RANGE = "A:Z";

interface GoogleSheetsSyncProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
  onDeleteTransaction?: (id: string) => Promise<void>;
  expenseCategories?: { id: string; name: string; type: string; sortOrder?: number }[];
  getAllTransactions?: () => Promise<Transaction[]>;
}

type SheetExport = {
  id: string;
  export_type: 'transactions' | 'pdf';
  spreadsheet_id: string;
  sheet_range: string;
};

const AUTO_SYNC_KEY = 'google_sheets_auto_sync';
const AUTO_DELETE_CHECK_KEY = 'google_sheets_auto_delete_check';
const DELETE_CHECK_INTERVAL = 60000; // 1 minute

const normalizeCategoryName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

const uniqueExpenseCategories = (categories: GoogleSheetsSyncProps['expenseCategories']) => {
  const seen = new Set<string>();
  return categories
    .filter(cat => cat.type === 'expense')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .filter(cat => {
      const key = normalizeCategoryName(cat.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const GoogleSheetsSync = ({ transactions, getAllTransactions, getCategoryName, onDeleteTransaction, expenseCategories = [] }: GoogleSheetsSyncProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(AUTO_SYNC_KEY);
    return saved === 'true';
  });
  const [autoDeleteCheck, setAutoDeleteCheck] = useState(() => {
    const saved = localStorage.getItem(AUTO_DELETE_CHECK_KEY);
    return saved === 'true';
  });
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [lastDeleteCheckTime, setLastDeleteCheckTime] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  
  // User-specific settings
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [archivedPdfSpreadsheetId, setArchivedPdfSpreadsheetId] = useState('');
  const [sheetRange, setSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [tempSpreadsheetId, setTempSpreadsheetId] = useState('');
  const [tempSheetName, setTempSheetName] = useState('');
  const [tempSheetRange, setTempSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [tempArchivedPdfSpreadsheetId, setTempArchivedPdfSpreadsheetId] = useState('');
  const [tempArchivedPdfSheetName, setTempArchivedPdfSheetName] = useState('');
  const [tempArchivedPdfSheetRange, setTempArchivedPdfSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [exportType, setExportType] = useState<'transactions' | 'pdf'>('transactions');
  const [exports, setExports] = useState<SheetExport[]>([]);
  const [editingExportId, setEditingExportId] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  
  const prevTransactionsRef = useRef<string>('');
  const isFirstRender = useRef(true);
  const deleteCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load user settings from profiles table
  useEffect(() => {
    const loadUserSettings = async () => {
      if (!user) return;
      
      setIsLoadingSettings(true);
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('spreadsheet_id, sheet_range, archived_pdf_spreadsheet_id, archived_pdf_sheet_range')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (error) {
          console.error('Error loading settings:', error);
        }
        
        const { data: savedExports, error: exportsError } = await supabase
          .from('google_sheet_exports' as any)
          .select('id, export_type, spreadsheet_id, sheet_range')
          .eq('user_id', user.id)
          .order('created_at');
        if (!exportsError) setExports((savedExports || []) as SheetExport[]);

        if (data) {
          // The migration adds the archive fields. Keep this compatible with clients
          // whose generated Supabase types have not been refreshed yet.
          const profile = data as typeof data & { archived_pdf_spreadsheet_id?: string | null; archived_pdf_sheet_range?: string | null };
          setSpreadsheetId(data.spreadsheet_id || '');
          setSheetRange(data.sheet_range || DEFAULT_SHEET_RANGE);
          setTempSpreadsheetId(data.spreadsheet_id || '');
          // Parse saved sheet_range like "'Data app'!A:I" into name + range
          const saved = data.sheet_range || DEFAULT_SHEET_RANGE;
          const savedMatch = saved.match(/^'?([^'!]+)'?!(.+)$/);
          setTempSheetName(savedMatch ? savedMatch[1] : '');
          setTempSheetRange(savedMatch ? savedMatch[2] : saved);
          // Archive PDF exports deliberately require a separate sheet. Never fall
          // back to the transaction synchronisation sheet.
          setArchivedPdfSpreadsheetId(profile.archived_pdf_spreadsheet_id || '');
          setTempArchivedPdfSpreadsheetId(profile.archived_pdf_spreadsheet_id || '');
          const archiveMatch = (profile.archived_pdf_sheet_range || '').match(/^'?([^'!]+)'?!(.+)$/);
          setTempArchivedPdfSheetName(archiveMatch ? archiveMatch[1] : '');
          setTempArchivedPdfSheetRange(archiveMatch ? archiveMatch[2] : DEFAULT_SHEET_RANGE);
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

  const saveSettings = async () => {
    if (!user) return;
    
    setIsSavingSettings(true);
    try {
      const isPdf = exportType === 'pdf';
      const inputId = isPdf ? tempArchivedPdfSpreadsheetId : tempSpreadsheetId;
      const name = isPdf ? tempArchivedPdfSheetName : tempSheetName;
      const configuredRange = isPdf ? tempArchivedPdfSheetRange : tempSheetRange;
      const spreadsheet_id = extractSpreadsheetId(inputId);
      if (!spreadsheet_id) throw new Error('Укажите таблицу для экспорта');
      const sheet_range = name.trim() ? `'${name.trim()}'!${configuredRange.trim() || DEFAULT_SHEET_RANGE}` : (configuredRange.trim() || DEFAULT_SHEET_RANGE);
      const fields = { user_id: user.id, export_type: exportType, spreadsheet_id, sheet_range };
      const previous = editingExportId ? exports.find(item => item.id === editingExportId) : undefined;
      if (previous && (previous.sheet_range !== sheet_range || previous.spreadsheet_id !== spreadsheet_id)) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Пожалуйста, войдите в систему повторно');
        const cleanup = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sheets-export`, {
          method: 'POST', headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ accessToken: session.access_token, action: 'clear_notes', exportId: previous.id, exportType: previous.export_type }),
        });
        if (!cleanup.ok) throw new Error('Не удалось удалить старые примечания в прежнем диапазоне');
      }
      const request = editingExportId
        ? supabase.from('google_sheet_exports' as any).update(fields as any).eq('id', editingExportId).eq('user_id', user.id)
        : supabase.from('google_sheet_exports' as any).insert(fields as any);
      const { data: savedExport, error } = await request.select('id, export_type, spreadsheet_id, sheet_range').single();
      
      if (error) throw error;
      
      const updated = savedExport as SheetExport;
      setExports(current => editingExportId ? current.map(item => item.id === editingExportId ? updated : item) : [...current, updated]);
      setEditingExportId(null);
      setSettingsDialogOpen(false);
      
      toast({
        title: editingExportId ? 'Экспорт обновлён' : 'Экспорт добавлен',
        description: 'Настройка сохранена отдельно от остальных экспортов',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        title: 'Ошибка сохранения',
        description: error instanceof Error ? error.message : 'Неизвестная ошибка',
        variant: 'destructive',
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const syncToSheets = useCallback(async (txs: Transaction[], target?: SheetExport) => {
    if (!(target?.spreadsheet_id || spreadsheetId)) {
      toast({
        title: 'Настройте таблицу',
        description: 'Пожалуйста, укажите ID вашей Google таблицы в настройках',
        variant: 'destructive',
      });
      return false;
    }

    // Check if user is authenticated
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: 'Ошибка авторизации',
        description: 'Пожалуйста, войдите в систему',
        variant: 'destructive',
      });
      return false;
    }

    setSyncStatus('syncing');
    try {
      const exportTransactions = getAllTransactions ? await getAllTransactions() : txs;
      // Compact format: Date | Income | [expense categories sorted by sortOrder]
      const sortedExpense = uniqueExpenseCategories(expenseCategories);

      const headers = ['Date', 'Income', ...sortedExpense.map(c => c.name), 'Прочее'];
      const fallbackCol = headers.length - 1;

      // Group by date, sort dates descending
      const dateMap = new Map<string, Transaction[]>();
      for (const tx of exportTransactions) {
        const dateKey = new Date(tx.date).toLocaleDateString('pl-PL');
        if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
        dateMap.get(dateKey)!.push(tx);
      }
      const sortedDates = Array.from(dateMap.keys()).sort((a, b) => {
        const parse = (s: string) => { const [d, m, y] = s.split('.'); return new Date(+y, +m - 1, +d).getTime(); };
        return parse(b) - parse(a);
      });

      const rows: string[][] = [];
      const notes: { row: number; col: number; note: string }[] = [];

      sortedDates.forEach(dateKey => {
        const dayTxs = [...dateMap.get(dateKey)!]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        // Keep one amount per cell. Operations of the same day share a row
        // only when they use different columns; a collision gets a new row
        // with the date repeated.
        const dayRows: string[][] = [];

        dayTxs.forEach((tx) => {
          let col: number;
          if (tx.type === 'income') {
            col = 1;
          } else {
            let idx = sortedExpense.findIndex(c => c.id === tx.category);
            if (idx === -1 && tx.departmentName) {
              idx = sortedExpense.findIndex(c => c.name === tx.departmentName);
            }
            col = idx !== -1 ? 2 + idx : fallbackCol;
          }

          if (col !== -1) {
            let row = dayRows.find(candidate => !candidate[col]);
            if (!row) {
              row = new Array(headers.length).fill('');
              row[0] = dateKey;
              dayRows.push(row);
            }
            const rowIndex = rows.length + dayRows.indexOf(row);
            const amountWithCurrency = `${tx.amount} ${tx.currency}`;
            row[col] = amountWithCurrency;
            const noteParts: string[] = [];
            if (tx.issuedTo) noteParts.push(`Кому: ${tx.issuedTo}`);
            if (tx.departmentName) noteParts.push(`Отдел: ${tx.departmentName}`);
            if (tx.description) noteParts.push(`Описание: ${tx.description}`);
            if (tx.comment && tx.comment !== tx.description) noteParts.push(`Комментарий: ${tx.comment}`);
            if (tx.bankTitle) noteParts.push(`Tytuł: ${tx.bankTitle}`);
            if (tx.bankSender) noteParts.push(`Nadawca: ${tx.bankSender}`);
            if (tx.bankRecipient) noteParts.push(`Odbiorca: ${tx.bankRecipient}`);
            if (noteParts.length > 0) notes.push({ row: rowIndex + 1, col, note: noteParts.join('\n') });
          }
        });
        rows.push(...dayRows);
      });

      const values = [headers, ...rows];

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sheets-export`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          accessToken: session.access_token,
          action: 'write',
          exportId: target?.id,
          values,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || `Ошибка экспорта (${response.status})`);
      }

      setLastSyncTime(new Date());
      setSyncStatus('success');
      
      return true;
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');
      toast({
        title: 'Ошибка синхронизации',
        description: error instanceof Error ? error.message : 'Проверьте настройки таблицы',
        variant: 'destructive',
      });
      return false;
    }
  }, [getAllTransactions, getCategoryName, toast, spreadsheetId, sheetRange]);

  // Auto-sync when transactions change
  useEffect(() => {
    if (!autoSync || !spreadsheetId) return;
    
    const currentTransactionsStr = JSON.stringify(
      transactions.map(t => ({ id: t.id, amount: t.amount, type: t.type, category: t.category, date: t.date, description: t.description }))
    );
    
    // Skip first render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevTransactionsRef.current = currentTransactionsStr;
      return;
    }
    
    // Check if transactions changed
    if (currentTransactionsStr !== prevTransactionsRef.current) {
      prevTransactionsRef.current = currentTransactionsStr;
      
      // Debounce sync to avoid too many requests
      const timeoutId = setTimeout(() => {
        syncToSheets(transactions).then(success => {
          if (success) {
            toast({
              title: 'Автосинхронизация',
              description: 'Данные синхронизированы с Google Sheets',
            });
          }
        });
      }, 1000);
      
      return () => clearTimeout(timeoutId);
    }
  }, [transactions, autoSync, syncToSheets, toast, spreadsheetId]);

  const handleAutoSyncChange = (enabled: boolean) => {
    if (!spreadsheetId && enabled) {
      toast({
        title: 'Настройте таблицу',
        description: 'Сначала укажите ID вашей Google таблицы в настройках',
        variant: 'destructive',
      });
      return;
    }
    
    setAutoSync(enabled);
    localStorage.setItem(AUTO_SYNC_KEY, String(enabled));
    
    if (enabled) {
      // Sync immediately when enabled
      syncToSheets(transactions).then(success => {
        if (success) {
          toast({
            title: 'Автосинхронизация включена',
            description: 'Данные будут автоматически синхронизироваться',
          });
        }
      });
    } else {
      toast({
        title: 'Автосинхронизация отключена',
      });
    }
  };

  // Silent check for deletions (no toast on success if no deletions)
  const checkForDeletions = useCallback(async (silent: boolean = true) => {
    if (!spreadsheetId || !onDeleteTransaction) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    
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
      if (rows.length > 1) {
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
            title: 'Автоудаление',
            description: `Удалено ${deletedCount} транзакций из Google Sheets`,
          });
          
          // Re-export to update the sheet
          setTimeout(() => {
            syncToSheets(transactions.filter(t => 
              !rows.some((row: string[]) => row[0] === t.id && row[8]?.toString().trim())
            ));
          }, 500);
        }
        
        setLastDeleteCheckTime(new Date());
      }
    } catch (error) {
      if (!silent) {
        console.error('Delete check error:', error);
      }
    }
  }, [spreadsheetId, sheetRange, onDeleteTransaction, syncToSheets, transactions, toast]);

  // Auto delete check interval
  useEffect(() => {
    if (autoDeleteCheck && spreadsheetId && onDeleteTransaction) {
      // Initial check
      checkForDeletions(true);
      
      // Set up interval
      deleteCheckIntervalRef.current = setInterval(() => {
        checkForDeletions(true);
      }, DELETE_CHECK_INTERVAL);
      
      return () => {
        if (deleteCheckIntervalRef.current) {
          clearInterval(deleteCheckIntervalRef.current);
        }
      };
    } else {
      if (deleteCheckIntervalRef.current) {
        clearInterval(deleteCheckIntervalRef.current);
      }
    }
  }, [autoDeleteCheck, spreadsheetId, onDeleteTransaction, checkForDeletions]);

  const handleAutoDeleteCheckChange = (enabled: boolean) => {
    if (!spreadsheetId && enabled) {
      toast({
        title: 'Настройте таблицу',
        description: 'Сначала укажите ID вашей Google таблицы в настройках',
        variant: 'destructive',
      });
      return;
    }
    
    setAutoDeleteCheck(enabled);
    localStorage.setItem(AUTO_DELETE_CHECK_KEY, String(enabled));
    
    if (enabled) {
      checkForDeletions(false);
      toast({
        title: 'Автопроверка удалений включена',
        description: 'Проверка каждую минуту',
      });
    } else {
      toast({
        title: 'Автопроверка удалений отключена',
      });
    }
  };

  const handleExport = async (target?: SheetExport) => {
    if (!(target?.spreadsheet_id || spreadsheetId)) {
      openExportSettings('transactions');
      return false;
    }
    
    setIsExporting(true);
    const success = await syncToSheets(transactions, target);
    setIsExporting(false);
    
    return success;
  };

  const handleSync = async (target?: SheetExport) => {
    if (!(target?.spreadsheet_id || spreadsheetId)) {
      openExportSettings('transactions');
      return;
    }

    toast({
      title: 'Синхронизация',
      description: 'Начинаем синхронизацию с Google Sheets...',
    });

      // Export transaction data. Import is deliberately not run here because
      // the export endpoint is a one-way Google Sheets integration.
    const exportSuccess = await handleExport(target);
    if (exportSuccess) {
      toast({
        title: 'Синхронизация завершена',
        description: 'Синхронизированы все имеющиеся транзакции',
      });
    }
  };

  const handleImport = async () => {
    if (!spreadsheetId) {
      openExportSettings('transactions');
      return;
    }
    
    // Check if user is authenticated
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

      // Check for rows marked for deletion (column I with any value like "x", "delete", "1", etc.)
      const rows = data?.values || [];
      if (rows.length > 1 && onDeleteTransaction) {
        let deletedCount = 0;
        
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const transactionId = row[0]; // ID is now in first column
          const deleteMarker = row[8]?.toString().trim().toLowerCase(); // DELETE column (I)
          
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
          
          // Re-export to update the sheet without deleted rows
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
  };

  const extractSpreadsheetId = (input: string): string => {
    // Try to extract ID from URL
    const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    // Return as-is if it looks like an ID
    return input.trim();
  };

  const openExportSettings = (type: 'transactions' | 'pdf', target?: SheetExport) => {
    setExportType(target?.export_type || type);
    setEditingExportId(target?.id || null);
    const [name = '', configuredRange = DEFAULT_SHEET_RANGE] = (target?.sheet_range || DEFAULT_SHEET_RANGE).match(/^'?([^'!]+)'?!(.+)$/)?.slice(1) || ['', target?.sheet_range || DEFAULT_SHEET_RANGE];
    if (target?.export_type === 'pdf') {
      setTempArchivedPdfSpreadsheetId(target.spreadsheet_id);
      setTempArchivedPdfSheetName(name);
      setTempArchivedPdfSheetRange(configuredRange);
    } else if (target) {
      setTempSpreadsheetId(target.spreadsheet_id);
      setTempSheetName(name);
      setTempSheetRange(configuredRange);
    } else {
      setTempSpreadsheetId(''); setTempSheetName(''); setTempSheetRange(DEFAULT_SHEET_RANGE);
      setTempArchivedPdfSpreadsheetId(''); setTempArchivedPdfSheetName(''); setTempArchivedPdfSheetRange(DEFAULT_SHEET_RANGE);
    }
    setSettingsDialogOpen(true);
  };

  const openSpreadsheet = (id: string) => {
    if (id) window.open(`https://docs.google.com/spreadsheets/d/${id}`, '_blank', 'noopener,noreferrer');
  };

  const deleteExport = async (target: SheetExport) => {
    if (!user) return;
    const { error } = await supabase.from('google_sheet_exports' as any).delete().eq('id', target.id).eq('user_id', user.id);
    if (error) {
      toast({ title: 'Ошибка удаления', description: error.message, variant: 'destructive' });
      return;
    }
    setExports(current => current.filter(item => item.id !== target.id));
    toast({ title: 'Экспорт удалён' });
  };

  const syncArchivedPdfExports = async (target?: SheetExport) => {
    if (!user || !(target?.spreadsheet_id || archivedPdfSpreadsheetId)) {
      openExportSettings('pdf');
      return;
    }

    setIsExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Пожалуйста, войдите в систему повторно');

      const { data: notifications, error } = await supabase
        .from('notifications')
        .select('id, created_at, metadata')
        .eq('user_id', user.id);
      if (error) throw error;

      const pending = (notifications || []).filter((notification) => {
        const metadata = (notification.metadata || {}) as Record<string, unknown>;
        return Boolean(metadata.archived_at);
      }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

      const exportRows: string[][] = [];
      for (const notification of pending) {
        const metadata = (notification.metadata || {}) as Record<string, unknown>;
        const amount = Number(metadata.amount);
        if (!Number.isFinite(amount)) continue;

        const currency = String(metadata.currency || 'PLN');
        const archiveType = metadata.archive_type === 'income' ? 'income' : 'expense';
        const date = typeof metadata.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(metadata.date)
          ? metadata.date.slice(0, 10)
          : String(notification.created_at).slice(0, 10);
        const amountWithCurrency = `${amount} ${currency}`;
        const department = String(metadata.department_name || 'Расход');
        exportRows.push([
          date,
          archiveType === 'income' ? amountWithCurrency : '',
          archiveType === 'expense' ? department : '',
          archiveType === 'expense' ? amountWithCurrency : '',
          archiveType === 'expense' ? String(metadata.basis || '') : '',
        ]);
      }

      const exportResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sheets-export`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ accessToken: session.access_token, action: 'archive_pdf_export', exportId: target?.id, values: exportRows }),
      });
      if (!exportResponse.ok) {
        const payload = await exportResponse.json().catch(() => ({}));
        throw new Error(payload?.error || `Ошибка экспорта PDF (${exportResponse.status})`);
      }
      await Promise.all(pending.map((notification) => {
        const metadata = (notification.metadata || {}) as Record<string, unknown>;
        return supabase.from('notifications').update({ metadata: { ...metadata, archived_sheet_exported_at: new Date().toISOString() } }).eq('id', notification.id);
      }));

      toast({
        title: 'Синхронизация PDF завершена',
        description: exportRows.length ? `Передано записей: ${exportRows.length}` : 'В архиве пока нет PDF',
      });
    } catch (error) {
      console.error('Archived PDF export error:', error);
      toast({
        title: 'Ошибка синхронизации PDF',
        description: error instanceof Error ? error.message : 'Неизвестная ошибка',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoadingSettings) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm text-muted-foreground">Загрузка настроек...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-lg">Google Sheets</h4>
          <p className="text-sm text-muted-foreground">
            {spreadsheetId 
              ? 'Синхронизация с вашей таблицей'
              : 'Настройте вашу Google таблицу'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {syncStatus === 'syncing' && (
            <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
          )}
          {syncStatus === 'success' && autoSync && (
            <Cloud className="w-4 h-4 text-green-500" />
          )}
          {syncStatus === 'error' && (
            <CloudOff className="w-4 h-4 text-destructive" />
          )}
          
          <Dialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Настроить экспорт</DialogTitle>
                <DialogDescription>
                  Выберите данные для экспорта и укажите отдельную Google Таблицу
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2"><Label>Тип экспорта</Label><Select value={exportType} onValueChange={(value) => setExportType(value as 'transactions' | 'pdf')}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="transactions">Экспорт транзакций</SelectItem><SelectItem value="pdf">Экспорт данных PDF</SelectItem></SelectContent></Select></div>
                {exportType === 'transactions' && (<div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center gap-2"><Table2 className="w-4 h-4 text-primary" /><p className="text-sm font-semibold">Экспорт транзакций</p></div>
                  <div className="space-y-2">
                  <Label htmlFor="spreadsheet-id">ID таблицы или ссылка</Label>
                  <Input
                    id="spreadsheet-id"
                    placeholder="https://docs.google.com/spreadsheets/d/... или просто ID"
                    value={tempSpreadsheetId}
                    onChange={(e) => setTempSpreadsheetId(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Вставьте ссылку на таблицу или только ID
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sheet-name">Название листа</Label>
                  <Input
                    id="sheet-name"
                    placeholder="Лист1 (оставьте пустым — будет выбран первый лист)"
                    value={tempSheetName}
                    onChange={(e) => setTempSheetName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Название вкладки внизу таблицы, например: Data app, Sheet1
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sheet-range">Диапазон листа</Label>
                  <Input id="sheet-range" placeholder="A:Z" value={tempSheetRange} onChange={(e) => setTempSheetRange(e.target.value)} />
                  <p className="text-xs text-muted-foreground">Диапазон колонок, например: A:Z или A1:Z1000</p>
                </div>
                </div>)}

                {exportType === 'pdf' && (<div className="border rounded-lg p-3 space-y-3">
                  <div className="flex items-center gap-2"><FileDown className="w-4 h-4 text-amber-500" /><p className="text-sm font-semibold">Экспорт данных PDF</p></div>
                  <p className="text-xs text-muted-foreground">Это отдельное подключение: архив PDF не изменяет лист транзакций.</p>
                  <div className="space-y-2"><Label htmlFor="pdf-spreadsheet-id">ID таблицы или ссылка</Label><Input id="pdf-spreadsheet-id" placeholder="https://docs.google.com/spreadsheets/d/... или ID" value={tempArchivedPdfSpreadsheetId} onChange={(e) => setTempArchivedPdfSpreadsheetId(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="pdf-sheet-name">Название листа</Label><Input id="pdf-sheet-name" placeholder="Архив PDF" value={tempArchivedPdfSheetName} onChange={(e) => setTempArchivedPdfSheetName(e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="pdf-sheet-range">Диапазон листа</Label><Input id="pdf-sheet-range" placeholder="A:Z" value={tempArchivedPdfSheetRange} onChange={(e) => setTempArchivedPdfSheetRange(e.target.value)} /><p className="text-xs text-muted-foreground">По умолчанию A:Z. Колонки: дата · доход · отдел · расход. «Na podstawie» будет примечанием к расходу.</p></div>
                </div>)}

                <div className="bg-muted/50 p-3 rounded-lg space-y-2">
                  <p className="text-sm font-medium">Как настроить:</p>
                  <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
                    <li>Создайте новую Google таблицу</li>
                    <li>Откройте доступ для сервисного аккаунта</li>
                    <li>Скопируйте ссылку или ID таблицы</li>
                    <li>Вставьте сюда и сохраните</li>
                  </ol>
                </div>
                
                <Button 
                  onClick={saveSettings} 
                  disabled={isSavingSettings}
                  className="w-full"
                >
                  {isSavingSettings ? (
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Сохранить настройки
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="space-y-2">
        {exports.map(target => <div key={target.id} className="w-full flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3 text-left">
          {target.export_type === 'pdf' ? <FileDown className="h-4 w-4 text-amber-500" /> : <Table2 className="h-4 w-4 text-primary" />}
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">{target.export_type === 'pdf' ? 'Экспорт данных PDF' : 'Экспорт транзакций'}</p><p className="text-xs text-muted-foreground truncate">Таблица: {target.spreadsheet_id.slice(0, 12)}… · {target.sheet_range}</p></div>
          <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={() => target.export_type === 'pdf' ? syncArchivedPdfExports(target) : handleSync(target)} disabled={isExporting} title="Синхронизация"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openSpreadsheet(target.spreadsheet_id)} title="Открыть таблицу"><ExternalLink className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openExportSettings(target.export_type, target)} title="Изменить"><Settings className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => deleteExport(target)} title="Удалить"><Trash2 className="h-4 w-4" /></Button></div>
        </div>)}
        <Button variant="outline" className="w-full gap-2" onClick={() => openExportSettings('transactions')}><Plus className="h-4 w-4" />Добавить экспорт</Button>
      </div>
      
      {spreadsheetId && (
        <>
          <div className="space-y-3">
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
              <Switch
                id="auto-sync"
                checked={autoSync}
                onCheckedChange={handleAutoSyncChange}
              />
              <Label htmlFor="auto-sync" className="cursor-pointer flex-1">
                Автоматическая синхронизация
              </Label>
            </div>
            
            <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
              <Switch
                id="auto-delete-check"
                checked={autoDeleteCheck}
                onCheckedChange={handleAutoDeleteCheckChange}
              />
              <Label htmlFor="auto-delete-check" className="cursor-pointer flex-1">
                Автопроверка удалений (каждую минуту)
              </Label>
            </div>
          </div>
          
          <div className="text-xs text-muted-foreground space-y-1">
            {lastSyncTime && (
              <p>Последняя синхронизация: {lastSyncTime.toLocaleTimeString('pl-PL')}</p>
            )}
            {lastDeleteCheckTime && autoDeleteCheck && (
              <p>Последняя проверка удалений: {lastDeleteCheckTime.toLocaleTimeString('pl-PL')}</p>
            )}
          </div>
        </>
      )}
      
    </div>
  );
};
