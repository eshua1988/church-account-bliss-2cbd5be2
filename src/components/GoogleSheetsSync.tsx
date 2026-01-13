import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { RefreshCw, Upload, Download, Cloud, CloudOff, Settings, Save, ExternalLink } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';

const DEFAULT_SHEET_RANGE = "'Data app'!A:G";

interface GoogleSheetsSyncProps {
  transactions: Transaction[];
  getCategoryName: (id: string) => string;
}

const AUTO_SYNC_KEY = 'google_sheets_auto_sync';

export const GoogleSheetsSync = ({ transactions, getCategoryName }: GoogleSheetsSyncProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [autoSync, setAutoSync] = useState(() => {
    const saved = localStorage.getItem(AUTO_SYNC_KEY);
    return saved === 'true';
  });
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>('idle');
  
  // User-specific settings
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetRange, setSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [tempSpreadsheetId, setTempSpreadsheetId] = useState('');
  const [tempSheetRange, setTempSheetRange] = useState(DEFAULT_SHEET_RANGE);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  
  const prevTransactionsRef = useRef<string>('');
  const isFirstRender = useRef(true);

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
          setTempSpreadsheetId(data.spreadsheet_id || '');
          setTempSheetRange(data.sheet_range || DEFAULT_SHEET_RANGE);
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
      const { error } = await supabase
        .from('profiles')
        .update({
          spreadsheet_id: tempSpreadsheetId || null,
          sheet_range: tempSheetRange || DEFAULT_SHEET_RANGE,
        })
        .eq('user_id', user.id);
      
      if (error) throw error;
      
      setSpreadsheetId(tempSpreadsheetId);
      setSheetRange(tempSheetRange || DEFAULT_SHEET_RANGE);
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

      const { data, error } = await supabase.functions.invoke('google-sheets', {
        body: {
          action: 'write',
          spreadsheetId: spreadsheetId,
          range: sheetRange,
          values,
        },
      });

      if (error) {
        console.error('Sync error details:', error);
        throw error;
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

  const handleExport = async () => {
    if (!spreadsheetId) {
      setSettingsDialogOpen(true);
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
    } else {
      toast({
        title: 'Ошибка экспорта',
        variant: 'destructive',
      });
    }
  };

  const handleImport = async () => {
    if (!spreadsheetId) {
      setSettingsDialogOpen(true);
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

  const extractSpreadsheetId = (input: string): string => {
    // Try to extract ID from URL
    const urlMatch = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    // Return as-is if it looks like an ID
    return input.trim();
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
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon">
                <Settings className="w-4 h-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Настройки Google Sheets</DialogTitle>
                <DialogDescription>
                  Укажите ID или ссылку на вашу личную Google таблицу
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="spreadsheet-id">ID таблицы или ссылка</Label>
                  <Input
                    id="spreadsheet-id"
                    placeholder="https://docs.google.com/spreadsheets/d/... или ID"
                    value={tempSpreadsheetId}
                    onChange={(e) => setTempSpreadsheetId(extractSpreadsheetId(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Вставьте ссылку на таблицу или только ID
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="sheet-range">Диапазон листа</Label>
                  <Input
                    id="sheet-range"
                    placeholder="'Sheet1'!A:G"
                    value={tempSheetRange}
                    onChange={(e) => setTempSheetRange(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Название листа и диапазон колонок
                  </p>
                </div>
                
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
      
      {spreadsheetId && (
        <>
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
        </>
      )}
      
      <div className="flex gap-2">
        {!spreadsheetId ? (
          <Button
            variant="default"
            onClick={() => setSettingsDialogOpen(true)}
          >
            <Settings className="w-4 h-4 mr-2" />
            Настроить таблицу
          </Button>
        ) : (
          <>
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, '_blank')}
              title="Открыть таблицу"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};