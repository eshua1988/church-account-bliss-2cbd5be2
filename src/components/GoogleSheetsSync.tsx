import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Upload, Download, Cloud, CloudOff } from 'lucide-react';
import { useTranslation } from '@/contexts/LanguageContext';
import { Transaction } from '@/types/transaction';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

// Spreadsheet ID from environment variable for security
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SPREADSHEET_ID || '';
const SHEET_RANGE = 'Sheet1!A:G';

interface GoogleSheetsSyncProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
}

const AUTO_SYNC_KEY = 'google_sheets_auto_sync';

export const GoogleSheetsSync = ({ transactions, getCategoryName }: GoogleSheetsSyncProps) => {
  const { toast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(AUTO_SYNC_KEY);
    return saved === 'true';
  });
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  
  const prevTransactionsRef = useRef<string>('');
  const isFirstRender = useRef(true);

  const syncToSheets = useCallback(async (txs: Transaction[]) => {
    if (!SPREADSHEET_ID) {
      toast({
        title: 'Ошибка конфигурации',
        description: 'Spreadsheet ID не настроен',
        variant: 'destructive',
      });
      return false;
    }

    setSyncStatus('syncing');
    try {
      const headers = ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Description', 'ID'];
      const rows = txs.map(tx => [
        new Date(tx.date).toLocaleDateString('pl-PL'),
        tx.type,
        getCategoryName(tx.category),
        tx.amount.toString(),
        tx.currency,
        tx.description || '',
        tx.id,
      ]);

      const values = [headers, ...rows];

      const { error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'write',
          spreadsheetId: SPREADSHEET_ID,
          range: SHEET_RANGE,
          values,
        },
      });

      if (error) throw error;

      setLastSyncTime(new Date());
      setSyncStatus('success');
      
      return true;
    } catch (error) {
      console.error('Sync error:', error);
      setSyncStatus('error');
      return false;
    }
  }, [getCategoryName, toast]);

  // Auto-sync when transactions change
  useEffect(() => {
    if (!autoSync) return;
    
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
  }, [transactions, autoSync, syncToSheets, toast]);

  const handleAutoSyncChange = (enabled: boolean) => {
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

  const handleExport = async () => {
    setIsExporting(true);
    const success = await syncToSheets(transactions);
    setIsExporting(false);
    
    if (success) {
      toast({
        title: 'Экспорт завершен',
        description: `Экспортировано ${transactions.length} транзакций`,
      });
    } else {
      toast({
        title: 'Ошибка экспорта',
        variant: 'destructive',
      });
    }
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'read',
          spreadsheetId: SPREADSHEET_ID,
          range: SHEET_RANGE,
        },
      });

      if (error) throw error;

      toast({
        title: 'Импорт завершен',
        description: `Получено ${data?.values?.length || 0} строк`,
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-lg">Google Sheets</h4>
          <p className="text-sm text-muted-foreground">
            Синхронизация данных с Google Таблицей
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
        </div>
      </div>
      
      <div className="flex items-center space-x-2 p-3 bg-muted/50 rounded-lg">
        <Switch
          id="auto-sync"
          checked={autoSync}
          onCheckedChange={handleAutoSyncChange}
        />
        <Label htmlFor="auto-sync" className="cursor-pointer">
          Автоматическая синхронизация
        </Label>
      </div>
      
      {lastSyncTime && (
        <p className="text-xs text-muted-foreground">
          Последняя синхронизация: {lastSyncTime.toLocaleTimeString('pl-PL')}
        </p>
      )}
      
      <div className="flex gap-2">
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={isExporting || syncStatus === 'syncing'}
        >
          {isExporting ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          Экспорт
        </Button>
        <Button
          variant="outline"
          onClick={handleImport}
          disabled={isImporting}
        >
          {isImporting ? (
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Download className="w-4 h-4 mr-2" />
          )}
          Импорт
        </Button>
      </div>
    </div>
  );
};
