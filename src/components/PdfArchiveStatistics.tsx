import { useEffect, useMemo, useState } from 'react';
import { Archive, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Currency, Transaction, TransactionCategory } from '@/types/transaction';
import { CurrencyBalanceCard } from '@/components/CurrencyBalanceCard';
import { StatisticsTable } from '@/components/StatisticsTable';
import { useTranslation } from '@/contexts/LanguageContext';
import { usePdfArchiveEntries } from '@/hooks/usePdfArchiveEntries';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { openPdfUrl } from '@/lib/pdfDownload';
import { syncPdfArchiveExportsOnly } from '@/components/GoogleSheetsSync';
import { useAuth } from '@/contexts/AuthContext';

interface PdfArchiveStatisticsProps {
  categories: { id: string; name: string; type: string }[];
  getCategoryName: (id: string) => string;
}

const currencies: Currency[] = ['PLN', 'USD', 'EUR', 'UAH', 'RUB', 'BYN'];

const asCurrency = (value: unknown): Currency =>
  currencies.includes(value as Currency) ? value as Currency : 'PLN';

export const PdfArchiveStatistics = ({ categories, getCategoryName }: PdfArchiveStatisticsProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { entries } = usePdfArchiveEntries();
  const [protocolSourceIds, setProtocolSourceIds] = useState<string[]>([]);
  const [protocolSourcePaths, setProtocolSourcePaths] = useState<string[]>([]);

  useEffect(() => {
    if (!user) {
      setProtocolSourceIds([]);
      setProtocolSourcePaths([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await (supabase as any)
        .from('reminders')
        .select('recurring_pdf')
        .eq('user_id', user.id)
        .not('recurring_pdf', 'is', null);
      if (error || cancelled) return;
      const decisions = (data || []).map((row: any) => row.recurring_pdf || {});
      setProtocolSourceIds(decisions.map((decision: any) => String(decision.source_entry_id || '')).filter(Boolean));
      setProtocolSourcePaths(decisions.map((decision: any) => String(decision.source_pdf_path || '')).filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [user]);
  const archiveTransactions = useMemo<Transaction[]>(() => entries.map(entry => {
    const date = new Date(entry.document_date);
    const basis = entry.basis || entry.department_name || 'Архивный PDF';
    return {
      id: `pdf-${entry.id}`,
      type: entry.type,
      amount: entry.amount,
      currency: asCurrency(entry.currency),
      category: (entry.category_id || 'other') as TransactionCategory,
      description: basis,
      date: Number.isNaN(date.getTime()) ? new Date(entry.created_at) : date,
      createdAt: new Date(entry.created_at),
      issuedTo: entry.issued_to || undefined,
      sourcePdfPath: entry.source_pdf_path || undefined,
      departmentName: entry.department_name || basis,
      comment: 'PDF-архив',
    };
  }), [entries]);

  const protocolTransactions = useMemo(() => {
    const ids = new Set(protocolSourceIds);
    const paths = new Set(protocolSourcePaths);
    return archiveTransactions.filter(transaction =>
      ids.has(transaction.id.replace(/^pdf-/, '')) ||
      Boolean(transaction.sourcePdfPath && paths.has(transaction.sourcePdfPath)),
    );
  }, [archiveTransactions, protocolSourceIds, protocolSourcePaths]);

  const availableCurrencies = useMemo(() => [...new Set(archiveTransactions.map(transaction => transaction.currency))] as Currency[], [archiveTransactions]);

  const getBalance = (currency: Currency) => {
    const rows = archiveTransactions.filter(transaction => transaction.currency === currency);
    const income = rows.filter(transaction => transaction.type === 'income').reduce((sum, transaction) => sum + transaction.amount, 0);
    const expense = rows.filter(transaction => transaction.type === 'expense').reduce((sum, transaction) => sum + transaction.amount, 0);
    return { income, expense, balance: income - expense };
  };

  const openSourcePdf = async (transaction: Transaction) => {
    if (!transaction.sourcePdfPath) {
      toast({ title: 'Исходный PDF не найден', description: 'Для этой записи путь к документу не сохранён.', variant: 'destructive' });
      return;
    }
    try {
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;
      const sourceUserId = transaction.sourcePdfPath.split('/')[0];
      if (!sourceUserId) throw new Error('Не указан владелец исходного PDF');
      const params = new URLSearchParams({ action: 'sign', filePath: transaction.sourcePdfPath, userId: sourceUserId });
      const response = await fetch(`${supabaseUrl}/functions/v1/upload-payout-pdf?${params}`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
      });
      const result = await response.json();
      if (!response.ok || !result.signedUrl) throw new Error(result.error || 'Не удалось получить ссылку на PDF');
      // The signature covers the complete query string; do not append cache-busters.
      openPdfUrl(result.signedUrl);
    } catch (error) {
      console.error('Error opening source PDF:', error);
      toast({ title: 'Не удалось открыть PDF', description: 'Проверьте, что исходный файл ещё доступен.', variant: 'destructive' });
    }
  };

  const deleteSelectedArchiveTransactions = async (transactionIds: string[]) => {
    const entryIds = transactionIds.map(id => id.replace(/^pdf-/, '')).filter(Boolean);
    const selectedEntries = entries.filter(entry => entryIds.includes(entry.id));
    if (!selectedEntries.length) return false;
    if (!window.confirm(`Удалить без возможности восстановления ${selectedEntries.length} PDF-транзакц. из базы и Google Sheets?`)) return false;
    try {
      // Legacy recovery reads the notification metadata. Remember deleted receipt
      // indexes there so a later sync cannot recreate an intentionally deleted row.
      const byNotification = new Map<string, number[]>();
      selectedEntries.forEach(entry => {
        if (!entry.source_notification_id) return;
        byNotification.set(entry.source_notification_id, [...(byNotification.get(entry.source_notification_id) || []), entry.receipt_index]);
      });
      for (const [notificationId, receiptIndexes] of byNotification) {
        const { data: notification, error } = await supabase.from('notifications').select('metadata').eq('id', notificationId).maybeSingle();
        if (error) throw error;
        const metadata = (notification?.metadata || {}) as Record<string, unknown>;
        const alreadyDeleted = Array.isArray(metadata.deleted_archive_receipt_indices)
          ? metadata.deleted_archive_receipt_indices.map(Number).filter(Number.isInteger)
          : [];
        const deletedIndexes = [...new Set([...alreadyDeleted, ...receiptIndexes])];
        const { error: updateError } = await supabase.from('notifications').update({
          metadata: { ...metadata, deleted_archive_receipt_indices: deletedIndexes },
        }).eq('id', notificationId);
        if (updateError) throw updateError;
      }
      const { error: deleteError } = await (supabase as any).from('pdf_archive_entries').delete().in('id', entryIds);
      if (deleteError) throw deleteError;
      const exportsCount = await syncPdfArchiveExportsOnly();
      toast({ title: 'PDF-транзакции удалены навсегда', description: exportsCount ? `Обновлено таблиц Google Sheets: ${exportsCount}` : 'Настроенных PDF-экспортов нет.' });
      return true;
    } catch (error) {
      console.error('PDF archive deletion failed:', error);
      toast({ title: 'Не удалось удалить PDF-транзакции', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      return false;
    }
  };

  return <section className="space-y-4">
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary"><Archive className="h-5 w-5" /></div>
      <div className="flex flex-wrap items-baseline gap-x-2"><h2 className="font-semibold">PDF</h2><p className="text-sm text-muted-foreground">— Категории сохранены из документа PDF.</p></div>
    </div>
    <Tabs defaultValue="balance" className="w-full">
      <TabsList className="flex-wrap h-auto gap-1 p-1">
        <TabsTrigger value="balance" className="text-xs sm:text-sm">{t('balanceByCurrency')}</TabsTrigger>
        <TabsTrigger value="table" className="text-xs sm:text-sm">{t('transactionsTable')}</TabsTrigger>
        <TabsTrigger value="protocols" className="text-xs sm:text-sm">Протоколы</TabsTrigger>
        <TabsTrigger value="calculator" className="text-xs sm:text-sm">Калькулятор</TabsTrigger>
      </TabsList>
      <TabsContent value="balance">
        {availableCurrencies.length === 0 ? <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground"><FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />В PDF-архиве пока нет документов с суммой.</div> : <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">{availableCurrencies.map((currency, index) => {
          const balance = getBalance(currency);
          return <CurrencyBalanceCard key={currency} currency={currency} income={balance.income} expense={balance.expense} balance={balance.balance} delay={index * 100} transactions={archiveTransactions} getCategoryName={getCategoryName} />;
        })}</div>}
      </TabsContent>
      <TabsContent value="table"><StatisticsTable transactions={archiveTransactions} getCategoryName={getCategoryName} categories={categories} onOpenPdf={openSourcePdf} onDeleteSelected={deleteSelectedArchiveTransactions} /></TabsContent>
      <TabsContent value="protocols">
        {protocolTransactions.length === 0
          ? <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground"><FileText className="mx-auto mb-3 h-10 w-10 opacity-40" />Для карточек выплат пока нет PDF-транзакций.</div>
          : <StatisticsTable transactions={protocolTransactions} getCategoryName={getCategoryName} categories={categories} onOpenPdf={openSourcePdf} />}
      </TabsContent>
      <TabsContent value="calculator"><StatisticsTable transactions={archiveTransactions} getCategoryName={getCategoryName} categories={categories} calculatorMode /></TabsContent>
    </Tabs>
  </section>;
};
