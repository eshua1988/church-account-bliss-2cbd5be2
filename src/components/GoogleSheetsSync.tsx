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
}

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

export const GoogleSheetsSync = ({ transactions, getCategoryName, onDeleteTransaction, expenseCategories = [] }: GoogleSheetsSyncProps) => {
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
      const extractedId = extractSpreadsheetId(tempSpreadsheetId);
      // Combine sheet name + range into full range string
      const fullRange = tempSheetName.trim()
        ? `'${tempSheetName.trim()}'!${tempSheetRange.trim() || DEFAULT_SHEET_RANGE}`
        : (tempSheetRange.trim() || DEFAULT_SHEET_RANGE);
      const archiveFullRange = tempArchivedPdfSheetName.trim()
        ? `'${tempArchivedPdfSheetName.trim()}'!${tempArchivedPdfSheetRange.trim() || DEFAULT_SHEET_RANGE}`
        : '';
      const { error } = await supabase
        .from('profiles')
        .upsert({
          user_id: user.id,
          spreadsheet_id: extractedId || null,
          sheet_range: fullRange,
          archived_pdf_spreadsheet_id: extractSpreadsheetId(tempArchivedPdfSpreadsheetId) || null,
          archived_pdf_sheet_range: archiveFullRange || null,
        } as any, { onConflict: 'user_id' });
      
      if (error) throw error;
      
      setSpreadsheetId(extractedId);
      setSheetRange(fullRange);
      setTempSpreadsheetId(extractedId);
      setArchivedPdfSpreadsheetId(extractSpreadsheetId(tempArchivedPdfSpreadsheetId));
      setSettingsDialogOpen(false);
      
      toast({
        title: 'Настройки сохранены',
        description: 'Ваша Google таблица настроена',
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

  const syncToSheets = useCallback(async (txs: Transaction[]) => {
    if (!spreadsheetId) {
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
      // Compact format: Date | Income | [expense categories sorted by sortOrder]
      const sortedExpense = uniqueExpenseCategories(expenseCategories);

      const headers = ['Date', 'Income', ...sortedExpense.map(c => c.name), 'Прочее'];
      const fallbackCol = headers.length - 1;

      // Group by date, sort dates descending
      const dateMap = new Map<string, Transaction[]>();
      for (const tx of txs) {
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

        dayTxs.forEach((tx, txIndex) => {
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

          const rowIndex = rows.length;
          const row: string[] = new Array(headers.length).fill('');
          row[0] = txIndex === 0 ? dateKey : '';
          if (col !== -1) {
            row[col] = `${tx.amount} ${tx.currency}`;
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
          rows.push(row);
        });
      });

      const values = [headers, ...rows];

      const { data, error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'write',
          spreadsheetId: spreadsheetId,
          range: sheetRange,
          values,
          notes,
        },
      });

      if (error) {
        console.error('Sync error details:', error);
        // Extract real message from Edge Function response body
        let msg = error.message;
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json();
            if (body?.error) msg = body.error;
          }
        } catch (_) { /* ignore */ }
        throw new Error(msg);
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
  }, [getCategoryName, toast, spreadsheetId, sheetRange]);

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

  const handleExport = async () => {
    if (!spreadsheetId) {
      openExportSettings('transactions');
      return false;
    }
    
    setIsExporting(true);
    const success = await syncToSheets(transactions);
    setIsExporting(false);
    
    return success;
  };

  const handleSync = async () => {
    if (!spreadsheetId) {
      openExportSettings('transactions');
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
      toast({
        title: 'Синхронизация завершена',
        description: `Синхронизировано ${transactions.length} транзакций`,
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

  const openExportSettings = (type: 'transactions' | 'pdf') => {
    setExportType(type);
    setSettingsDialogOpen(true);
  };

  const openSpreadsheet = (id: string) => {
    if (id) window.open(`https://docs.google.com/spreadsheets/d/${id}`, '_blank', 'noopener,noreferrer');
  };

  const deleteExport = async (type: 'transactions' | 'pdf') => {
    if (!user) return;
    const fields = type === 'transactions'
      ? { spreadsheet_id: null, sheet_range: null }
      : { archived_pdf_spreadsheet_id: null, archived_pdf_sheet_range: null };
    const { error } = await supabase.from('profiles').update(fields as any).eq('user_id', user.id);
    if (error) {
      toast({ title: 'Ошибка удаления', description: error.message, variant: 'destructive' });
      return;
    }
    if (type === 'transactions') setSpreadsheetId('');
    else setArchivedPdfSpreadsheetId('');
    toast({ title: 'Экспорт удалён' });
  };

  const syncArchivedPdfExports = async () => {
    if (!user || !archivedPdfSpreadsheetId) {
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
        return Boolean(metadata.archived_at) && !metadata.archived_sheet_exported_at;
      });

      let exported = 0;
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
        // `text/plain` with no custom headers is a CORS simple request. It is
        // needed on GitHub Pages where an OPTIONS preflight can be blocked by
        // the edge gateway before the function receives it.
        const exportResponse = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-sheets`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            accessToken: session.access_token,
            action: 'archive_pdf_export',
            values: [[
              date,
              archiveType === 'income' ? amountWithCurrency : '',
              archiveType === 'expense' ? department : '',
              archiveType === 'expense' ? amountWithCurrency : '',
            ]],
            note: String(metadata.basis || ''),
          }),
        });
        if (!exportResponse.ok) {
          const payload = await exportResponse.json().catch(() => ({}));
          throw new Error(payload?.error || `Ошибка экспорта PDF (${exportResponse.status})`);
        }

        const { error: updateError } = await supabase
          .from('notifications')
          .update({ metadata: { ...metadata, archived_sheet_exported_at: new Date().toISOString() } })
          .eq('id', notification.id);
        if (updateError) throw updateError;
        exported += 1;
      }

      toast({
        title: 'Синхронизация PDF завершена',
        description: exported ? `Передано записей: ${exported}` : 'Все архивированные PDF уже переданы',
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
        <div className="w-full flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3 text-left">
          <Table2 className="h-4 w-4 text-primary" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">Экспорт транзакций</p><p className="text-xs text-muted-foreground truncate">{spreadsheetId ? `Таблица: ${spreadsheetId.slice(0, 12)}… · ${sheetRange}` : 'Не настроен'}</p></div>
          <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={handleSync} title="Синхронизация"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openSpreadsheet(spreadsheetId)} disabled={!spreadsheetId} title="Открыть таблицу"><ExternalLink className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openExportSettings('transactions')} title="Изменить"><Settings className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => deleteExport('transactions')} disabled={!spreadsheetId} title="Удалить"><Trash2 className="h-4 w-4" /></Button></div>
        </div>
        <div className="w-full flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-3 text-left">
          <FileDown className="h-4 w-4 text-amber-500" />
          <div className="min-w-0 flex-1"><p className="text-sm font-medium">Экспорт данных PDF</p><p className="text-xs text-muted-foreground truncate">{archivedPdfSpreadsheetId ? `Таблица: ${archivedPdfSpreadsheetId.slice(0, 12)}…` : 'Не настроен — добавьте отдельную таблицу или лист'}</p></div>
          <div className="flex items-center gap-1"><Button variant="ghost" size="icon" onClick={syncArchivedPdfExports} disabled={isExporting} title="Синхронизация"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openSpreadsheet(archivedPdfSpreadsheetId)} disabled={!archivedPdfSpreadsheetId} title="Открыть таблицу"><ExternalLink className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => openExportSettings('pdf')} title="Изменить"><Settings className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => deleteExport('pdf')} disabled={!archivedPdfSpreadsheetId} title="Удалить"><Trash2 className="h-4 w-4" /></Button></div>
        </div>
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
