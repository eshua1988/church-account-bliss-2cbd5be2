import { ChangeEvent, useEffect, useState } from 'react';
import { Bell, CalendarDays, CircleStop, FileText, Loader2, Paperclip, Pencil, Plus, Settings, Trash2, X } from 'lucide-react';
import fontkit from '@pdf-lib/fontkit';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ROBOTO_FONT_BASE64 } from '@/lib/robotoFont';
import { amountInPolishWords } from '@/lib/amountInWords';

type Attachment = { path: string; name: string; type: string; source?: 'reminder' | 'archive' };
type Repeat = 'once' | 'weekly' | 'monthly' | 'yearly';
type ArchivedPdf = { id: string; path: string; name: string; label: string; amount: number; currency: string; departmentName: string; basis: string; issuedTo: string; categoryId: string };
type Reminder = {
  id: string;
  title: string;
  message: string;
  created_at: string;
  metadata: { full_name?: string; contact?: string; attachments?: Attachment[]; reminder_date?: string; reminder_time?: string; repeat?: Repeat; recurring_pdf?: Record<string, unknown> | null; closed_at?: string | null } | null;
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');
const isImage = (attachment: Attachment) => attachment.type.startsWith('image/');
const isPdfPaymentReminder = (reminder: Reminder) => Boolean(
  reminder.metadata?.recurring_pdf || (
    reminder.metadata?.repeat === 'monthly' &&
    reminder.metadata?.attachments?.some(attachment => attachment.source === 'archive')
  ),
);
const repeatLabel: Record<Repeat, string> = { once: 'Один раз', weekly: 'Раз в неделю', monthly: 'Раз в месяц', yearly: 'Раз в год' };
const today = () => new Date().toISOString().slice(0, 10);
const remindersTable = () => supabase.from('reminders' as any) as any;
const reminderSettingsTable = () => (supabase as any).from('reminder_settings') as any;
const fromRow = (row: any): Reminder => ({
  id: row.id,
  title: row.full_name,
  message: row.message,
  created_at: row.created_at,
  metadata: { full_name: row.full_name, contact: row.contact, attachments: row.attachments || [], reminder_date: row.reminder_date, reminder_time: String(row.reminder_time || '09:00').slice(0, 5), repeat: row.repeat, recurring_pdf: row.recurring_pdf || null, closed_at: row.closed_at || null },
});

export const RemindersPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Reminder | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [fullName, setFullName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [removedAttachmentPaths, setRemovedAttachmentPaths] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [reminderDate, setReminderDate] = useState(today());
  const [reminderTime, setReminderTime] = useState('09:00');
  const [repeat, setRepeat] = useState<Repeat>('once');
  const [pdfStartDate, setPdfStartDate] = useState(today());
  const [pdfRepeat, setPdfRepeat] = useState<Repeat>('monthly');
  const [reminderToClose, setReminderToClose] = useState<Reminder | null>(null);
  const [paymentEndDate, setPaymentEndDate] = useState(today());
  const [isArchivePdfReminder, setIsArchivePdfReminder] = useState(false);
  const [archivedPdfs, setArchivedPdfs] = useState<ArchivedPdf[]>([]);
  const [selectedArchivedPdfPath, setSelectedArchivedPdfPath] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentCurrency, setPaymentCurrency] = useState<'PLN' | 'EUR' | 'USD'>('PLN');

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await remindersTable()
      .select('id, full_name, contact, message, attachments, reminder_date, reminder_time, repeat, recurring_pdf, closed_at, created_at')
      .eq('user_id', user.id)
      .is('closed_at', null)
      .order('created_at', { ascending: false });
    if (error) toast({ title: 'Не удалось загрузить напоминания', description: error.message, variant: 'destructive' });
    else setReminders((data || []).map(fromRow));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user]);

  const loadSettings = async () => {
    if (!user) return;
    const { data, error } = await reminderSettingsTable()
      .select('reminder_date, reminder_time, repeat')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      toast({ title: 'Не удалось загрузить настройки уведомлений', description: error.message, variant: 'destructive' });
      return;
    }
    if (data) {
      setReminderDate(data.reminder_date || today());
      setReminderTime(String(data.reminder_time || '09:00').slice(0, 5));
      setRepeat(data.repeat || 'once');
    }
  };

  useEffect(() => { void loadSettings(); }, [user]);

  const saveSettings = async () => {
    if (!user) return;
    setSavingSettings(true);
    try {
      const settings = { user_id: user.id, reminder_date: reminderDate, reminder_time: reminderTime, repeat, updated_at: new Date().toISOString() };
      const { error: settingsError } = await reminderSettingsTable().upsert(settings, { onConflict: 'user_id' });
      if (settingsError) throw settingsError;
      const { error: remindersError } = await remindersTable()
        .update({ reminder_date: reminderDate, reminder_time: reminderTime, repeat })
        .eq('user_id', user.id)
        .is('closed_at', null);
      if (remindersError) throw remindersError;
      await load();
      setSettingsOpen(false);
      toast({ title: 'Настройки сохранены', description: 'Они применены ко всем активным карточкам.' });
    } catch (error) {
      toast({ title: 'Не удалось сохранить настройки', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setSavingSettings(false);
    }
  };

  const writePdfPayoutTotal = async (pdfPath: string, total: number, currency: 'PLN' | 'EUR' | 'USD', startedOn?: string, endedOn?: string) => {
    const { data: originalPdf, error: downloadError } = await supabase.storage.from('documents').download(pdfPath);
    if (downloadError || !originalPdf) throw downloadError || new Error('Исходный PDF не найден');
    const { PDFDocument, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(await originalPdf.arrayBuffer());
    pdfDoc.registerFontkit(fontkit);
    const fontBytes = Uint8Array.from(atob(ROBOTO_FONT_BASE64), character => character.charCodeAt(0));
    const font = await pdfDoc.embedFont(fontBytes);
    const page = pdfDoc.getPage(0);
    const { width, height } = page.getSize();
    const mmX = width / 210;
    const mmY = height / 297;
    const symbol = currency === 'PLN' ? 'zł' : currency === 'EUR' ? '€' : '$';
    const totalText = `${symbol} ${total.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}`;
    const dateText = [startedOn, endedOn].filter(Boolean).join(' - ');
    if (dateText) {
      // Date is the value cell on the first row of the payout template.
      page.drawRectangle({ x: 57 * mmX, y: height - 55 * mmY, width: 47 * mmX, height: 10 * mmY, color: rgb(1, 1, 1) });
      page.drawText(dateText, { x: 59 * mmX, y: height - 51 * mmY, size: dateText.length > 12 ? 6.5 : 9, font, color: rgb(0, 0, 0), maxWidth: 44 * mmX });
    }
    // The payout template has the amount value at 155–190 mm on the first row.
    page.drawRectangle({ x: 154 * mmX, y: height - 55 * mmY, width: 37 * mmX, height: 10 * mmY, color: rgb(1, 1, 1) });
    page.drawText(totalText, { x: 157 * mmX, y: height - 51 * mmY, size: 9, font, color: rgb(0, 0, 0) });
    const note = `Łączna kwota wypłat: ${totalText} (${amountInPolishWords(total, currency)})${endedOn ? ` · Data zakończenia wypłat: ${endedOn}` : ''}`;
    page.drawRectangle({ x: 13 * mmX, y: 9 * mmY, width: 184 * mmX, height: 8 * mmY, color: rgb(1, 1, 1) });
    page.drawText(note, { x: 14 * mmX, y: 12 * mmY, size: 7.2, font, color: rgb(0, 0, 0), maxWidth: 180 * mmX });
    const { error: uploadError } = await supabase.storage.from('documents').upload(
      pdfPath,
      new Blob([await pdfDoc.save() as BlobPart], { type: 'application/pdf' }),
      { contentType: 'application/pdf', upsert: true },
    );
    if (uploadError) throw uploadError;
  };

  useEffect(() => {
    if (!user || reminders.length === 0) return;
    void Promise.all(reminders.filter(isPdfPaymentReminder).map(async reminder => {
      const recurring = reminder.metadata?.recurring_pdf;
      const pdfPath = String(recurring?.source_pdf_path || reminder.metadata?.attachments?.find(item => item.source === 'archive')?.path || '');
      const sourceEntryId = String(recurring?.source_entry_id || '');
      const currency = String(recurring?.currency || 'PLN').toUpperCase();
      if (!pdfPath || !sourceEntryId || !['PLN', 'EUR', 'USD'].includes(currency)) return;
      const { data } = await (supabase as any).from('pdf_archive_entries').select('amount').eq('id', sourceEntryId).maybeSingle();
      const total = Number(data?.amount);
      if (Number.isFinite(total)) await writePdfPayoutTotal(pdfPath, total, currency as 'PLN' | 'EUR' | 'USD', String(recurring?.payment_start_date || ''));
    })).catch(error => console.warn('Could not refresh PDF payment totals', error));
  }, [user, reminders]);

  const resetForm = () => {
    setFullName('');
    setContact('');
    setMessage('');
    setFiles([]);
    setExistingAttachments([]);
    setRemovedAttachmentPaths([]);
    setEditing(null);
    setIsArchivePdfReminder(false);
    setArchivedPdfs([]);
    setSelectedArchivedPdfPath('');
    setPaymentAmount('');
    setPaymentCurrency('PLN');
    setPdfStartDate(today());
    setPdfRepeat('monthly');
  };

  const openNewReminder = () => {
    resetForm();
    setOpen(true);
  };

  const openArchivePdfReminder = async () => {
    if (!user) return;
    resetForm();
    setIsArchivePdfReminder(true);
    setPdfStartDate(today());
    setPdfRepeat('monthly');
    setOpen(true);
    const { data, error } = await (supabase as any)
      .from('pdf_archive_entries')
      .select('id, source_pdf_path, issued_to, amount, currency, category_id, department_name, basis, document_date, created_at')
      .eq('user_id', user.id)
      .not('source_pdf_path', 'is', null)
      .order('document_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Не удалось загрузить PDF-архив', description: error.message, variant: 'destructive' });
      return;
    }
    const usedPaths = new Set<string>();
    const options = (data || []).flatMap((entry: any): ArchivedPdf[] => {
      const path = String(entry.source_pdf_path || '');
      if (!path || usedPaths.has(path)) return [];
      usedPaths.add(path);
      const date = entry.document_date ? new Date(`${entry.document_date}T12:00:00`).toLocaleDateString('ru-RU') : '';
      const issuedTo = String(entry.issued_to || 'PDF без получателя');
      const amount = Number.isFinite(Number(entry.amount)) ? `${entry.amount} ${entry.currency || ''}`.trim() : '';
      const department = String(entry.department_name || 'без отдела');
      return [{
        id: String(entry.id),
        path,
        name: path.split('/').pop() || 'PDF из архива',
        label: [date, issuedTo, amount, department].filter(Boolean).join(' · '),
        amount: Number(entry.amount),
        currency: String(entry.currency || 'PLN'),
        departmentName: String(entry.department_name || ''),
        basis: String(entry.basis || ''),
        issuedTo,
        categoryId: String(entry.category_id || ''),
      }];
    });
    setArchivedPdfs(options);
  };

  const openEditReminder = (reminder: Reminder) => {
    const recurringPdf = reminder.metadata?.recurring_pdf;
    const archiveAttachment = reminder.metadata?.attachments?.find(attachment => attachment.source === 'archive');
    const isPdfPayment = isPdfPaymentReminder(reminder);
    setEditing(reminder);
    setFullName(reminder.metadata?.full_name || reminder.title);
    setContact(reminder.metadata?.contact || '');
    setMessage(reminder.message);
    setExistingAttachments(reminder.metadata?.attachments || []);
    setFiles([]);
    setIsArchivePdfReminder(isPdfPayment);
    setArchivedPdfs([]);
    setSelectedArchivedPdfPath(String(recurringPdf?.source_pdf_path || archiveAttachment?.path || ''));
    setPaymentAmount(recurringPdf?.amount !== undefined ? String(recurringPdf.amount) : '');
    setPdfStartDate(String(recurringPdf?.payment_start_date || today()));
    const savedPaymentRepeat = String(recurringPdf?.payment_repeat || 'monthly');
    setPdfRepeat(savedPaymentRepeat === 'once' || savedPaymentRepeat === 'weekly' || savedPaymentRepeat === 'yearly' ? savedPaymentRepeat : 'monthly');
    const savedCurrency = String(recurringPdf?.currency || 'PLN').toUpperCase();
    setPaymentCurrency(savedCurrency === 'EUR' || savedCurrency === 'USD' ? savedCurrency : 'PLN');
    setOpen(true);
  };

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files || []);
    const unsupported = selected.find(file => !file.type.startsWith('image/') && file.type !== 'application/pdf');
    const tooLarge = selected.find(file => file.size > 15 * 1024 * 1024);
    if (unsupported) {
      toast({ title: 'Неподдерживаемый файл', description: 'Можно прикреплять изображения и PDF.', variant: 'destructive' });
      return;
    }
    if (tooLarge) {
      toast({ title: 'Файл слишком большой', description: 'Размер одного файла — до 15 МБ.', variant: 'destructive' });
      return;
    }
    setFiles(previous => [...previous, ...selected]);
  };

  const saveReminder = async () => {
    if (!user) return;
    if (!fullName.trim() || !contact.trim() || !message.trim()) {
      toast({ title: 'Заполните все поля', description: 'Укажите имя, контакт и текст напоминания.', variant: 'destructive' });
      return;
    }
    if (isArchivePdfReminder && !selectedArchivedPdfPath) {
      toast({ title: 'Выберите PDF', description: 'Для постоянной выплаты нужен документ из PDF-архива.', variant: 'destructive' });
      return;
    }
    const parsedPaymentAmount = Number(paymentAmount.replace(',', '.'));
    if (isArchivePdfReminder && (!Number.isFinite(parsedPaymentAmount) || parsedPaymentAmount <= 0)) {
      toast({ title: 'Укажите сумму выплаты', description: 'Введите сумму больше нуля.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const uploadedPaths: string[] = [];
    try {
      const attachments: Attachment[] = [...existingAttachments];
      const selectedPdf = archivedPdfs.find(item => item.path === selectedArchivedPdfPath);
      const priorRecurringPdf = editing?.metadata?.recurring_pdf;
      const archivedPdf: ArchivedPdf | undefined = selectedPdf || (isArchivePdfReminder && selectedArchivedPdfPath ? {
        id: String(priorRecurringPdf?.source_entry_id || ''),
        path: selectedArchivedPdfPath,
        name: selectedArchivedPdfPath.split('/').pop() || 'PDF из архива',
        label: '',
        amount: parsedPaymentAmount,
        currency: paymentCurrency,
        departmentName: String(priorRecurringPdf?.department_name || ''),
        basis: String(priorRecurringPdf?.basis || ''),
        issuedTo: String(priorRecurringPdf?.issued_to || fullName.trim()),
        categoryId: String(priorRecurringPdf?.category_id || ''),
      } : undefined);
      if (archivedPdf && !attachments.some(item => item.path === archivedPdf.path)) {
        // This points to an existing archive file. It must never be deleted
        // when the reminder is later edited or removed.
        attachments.push({ path: archivedPdf.path, name: archivedPdf.name, type: 'application/pdf', source: 'archive' });
      }
      for (const file of files) {
        const id = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
        const path = `${user.id}/reminders/${id}-${safeFileName(file.name)}`;
        const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        uploadedPaths.push(path);
        attachments.push({ path, name: file.name, type: file.type });
      }

      const values = {
        full_name: fullName.trim(),
        contact: contact.trim(),
        message: message.trim(),
        attachments,
        // These scheduling values are global and apply to every card.
        // Notification timing is shared across every card, including PDF cards.
        reminder_date: reminderDate,
        reminder_time: reminderTime,
        repeat,
        recurring_pdf: archivedPdf ? {
          amount: parsedPaymentAmount,
          currency: paymentCurrency,
          department_name: archivedPdf.departmentName,
          basis: archivedPdf.basis,
          issued_to: archivedPdf.issuedTo,
          category_id: archivedPdf.categoryId,
          source_pdf_path: archivedPdf.path,
          source_entry_id: archivedPdf.id,
          payment_start_date: pdfStartDate,
          payment_repeat: pdfRepeat,
        } : null,
      };
      const { error } = editing
        ? await remindersTable().update(values).eq('id', editing.id)
        : await remindersTable().insert({ ...values, user_id: user.id });
      if (error) throw error;
      if (archivedPdf?.id) {
        const { error: archiveUpdateError } = await (supabase as any).from('pdf_archive_entries').update({ document_date: pdfStartDate }).eq('id', archivedPdf.id).eq('user_id', user.id);
        if (archiveUpdateError) throw archiveUpdateError;
      }
      if (editing && removedAttachmentPaths.length > 0) await supabase.storage.from('documents').remove(removedAttachmentPaths);

      toast({ title: editing ? 'Напоминание изменено' : 'Напоминание добавлено', description: 'Карточка и вложения сохранены.' });
      setOpen(false);
      resetForm();
      await load();
    } catch (error) {
      if (uploadedPaths.length > 0) await supabase.storage.from('documents').remove(uploadedPaths);
      toast({ title: 'Не удалось создать напоминание', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const removeExistingAttachment = (attachment: Attachment) => {
    setExistingAttachments(previous => previous.filter(item => item.path !== attachment.path));
    if (attachment.source !== 'archive') setRemovedAttachmentPaths(previous => [...previous, attachment.path]);
  };

  const removeNewFile = (file: File) => {
    setFiles(previous => previous.filter(item => item !== file));
  };

  const openPreview = async (reminder: Reminder) => {
    const attachments = reminder.metadata?.attachments || [];
    const entries = await Promise.all(attachments.map(async attachment => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(attachment.path, 60 * 15);
      return [attachment.path, data?.signedUrl || ''] as const;
    }));
    setPreviewUrls(Object.fromEntries(entries.filter(([, url]) => Boolean(url))));
    setPreview(reminder);
  };

  const deleteReminder = async (reminder: Reminder) => {
    if (!window.confirm(`Удалить напоминание «${reminder.title}»?`)) return;
    const attachments = reminder.metadata?.attachments || [];
    const { error } = await remindersTable().delete().eq('id', reminder.id);
    if (error) {
      toast({ title: 'Не удалось удалить напоминание', description: error.message, variant: 'destructive' });
      return;
    }
    const ownedPaths = attachments.filter(item => item.source !== 'archive').map(item => item.path);
    if (ownedPaths.length) await supabase.storage.from('documents').remove(ownedPaths);
    setReminders(previous => previous.filter(item => item.id !== reminder.id));
    toast({ title: 'Напоминание удалено' });
  };

  const closeRecurringPdfReminder = async (reminder: Reminder, endedOn: string) => {
    const recurringPdf = reminder.metadata?.recurring_pdf;
    const archiveAttachment = reminder.metadata?.attachments?.find(attachment => attachment.source === 'archive');
    const pdfPath = String(recurringPdf?.source_pdf_path || archiveAttachment?.path || '');
    if (!pdfPath) {
      toast({ title: 'PDF не найден', description: 'В карточке нет исходного PDF для отметки даты окончания.', variant: 'destructive' });
      return;
    }
    setClosingId(reminder.id);
    try {
      const sourceEntryId = String(recurringPdf?.source_entry_id || '');
      const { data: entry, error: entryError } = await (supabase as any).from('pdf_archive_entries').select('currency').eq('id', sourceEntryId).single();
      if (entryError || !entry) throw entryError || new Error('Исходная PDF-транзакция не найдена');
      // Amount is always the sum of entered recurring payments.  Amount that
      // happened to be printed in the original PDF is deliberately excluded.
      const { error: deleteFutureError } = await (supabase as any)
        .from('recurring_pdf_payment_occurrences')
        .delete()
        .eq('reminder_id', reminder.id)
        .gt('scheduled_for', endedOn);
      if (deleteFutureError) throw deleteFutureError;
      const { data: occurrences, error: occurrencesError } = await (supabase as any)
        .from('recurring_pdf_payment_occurrences')
        .select('amount')
        .eq('reminder_id', reminder.id);
      if (occurrencesError) throw occurrencesError;
      const paymentTotal = (occurrences || []).reduce((total: number, occurrence: any) => total + Number(occurrence.amount || 0), 0);
      const { error: totalUpdateError } = await (supabase as any)
        .from('pdf_archive_entries')
        .update({ amount: paymentTotal })
        .eq('id', sourceEntryId)
        .eq('user_id', user.id);
      if (totalUpdateError) throw totalUpdateError;
      const currency = String(entry.currency || recurringPdf?.currency || 'PLN').toUpperCase();
      if (!['PLN', 'EUR', 'USD'].includes(currency)) throw new Error('Неподдерживаемая валюта PDF-выплаты');
      const startedOn = String(recurringPdf?.payment_start_date || '');
      await writePdfPayoutTotal(pdfPath, paymentTotal, currency as 'PLN' | 'EUR' | 'USD', startedOn, endedOn);
      const { error: closeError } = await remindersTable().update({ closed_at: new Date().toISOString(), next_notification_at: null }).eq('id', reminder.id);
      if (closeError) throw closeError;
      await load();
      toast({ title: 'Выплата завершена', description: `Карточка закрыта, в PDF указан период ${startedOn} - ${endedOn}.` });
    } catch (error) {
      toast({ title: 'Не удалось завершить выплату', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setClosingId(null);
    }
  };

  return <section className="animate-fade-in mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Напоминания</h1><p className="text-muted-foreground">Выберите дату, повторение и сохраните контакт с файлами в одной карточке.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="gap-2" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4" />Настройки</Button>
        <Button className="gap-2" onClick={() => void openArchivePdfReminder()}><FileText className="h-4 w-4" />Добавить PDF</Button>
        <Button className="gap-2" onClick={openNewReminder}><Plus className="h-4 w-4" />Добавить напоминание</Button>
      </div>
    </div>

    {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div> : reminders.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Напоминаний пока нет.</div> : <div className="grid gap-4 sm:grid-cols-2">{reminders.map(reminder => {
      const attachments = reminder.metadata?.attachments || [];
      return <article key={reminder.id} className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{reminder.metadata?.full_name || reminder.title}</h2><p className="text-sm text-muted-foreground break-words">{reminder.metadata?.contact || 'Контакт не указан'}</p></div><Bell className="h-5 w-5 shrink-0 text-primary" /></div>
        <p className="mt-3 whitespace-pre-wrap text-sm">{reminder.message}</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{reminder.metadata?.reminder_date ? new Date(`${reminder.metadata.reminder_date}T12:00:00`).toLocaleDateString('ru-RU') : 'Дата не указана'} в {reminder.metadata?.reminder_time || '09:00'} · {repeatLabel[reminder.metadata?.repeat || 'once']}</p>
        <p className="mt-1 text-xs text-muted-foreground">{isPdfPaymentReminder(reminder) ? `Постоянная выплата по PDF (${repeatLabel[(String(reminder.metadata?.recurring_pdf?.payment_repeat || 'monthly') as Repeat)]}) · ` : ''}Вложений: {attachments.length} · создано {new Date(reminder.created_at).toLocaleDateString('ru-RU')}</p>
        <div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" className="flex-1 gap-2" onClick={() => void openPreview(reminder)}><Paperclip className="h-4 w-4" />Просмотреть</Button>{isPdfPaymentReminder(reminder) && <Button variant="outline" className="gap-2 text-destructive hover:text-destructive" disabled={closingId === reminder.id} onClick={() => { setReminderToClose(reminder); setPaymentEndDate(today()); }}>{closingId === reminder.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleStop className="h-4 w-4" />}Завершить выплату</Button>}<Button variant="ghost" size="icon" onClick={() => openEditReminder(reminder)} aria-label="Редактировать напоминание"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => void deleteReminder(reminder)} aria-label="Удалить напоминание"><Trash2 className="h-4 w-4" /></Button></div>
      </article>;
    })}</div>}

    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) resetForm(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editing ? 'Редактировать напоминание' : isArchivePdfReminder ? 'Новое напоминание с PDF' : 'Новое напоминание'}</DialogTitle><DialogDescription>{isArchivePdfReminder ? 'Заполните данные напоминания и выберите PDF, который уже есть в архиве.' : 'Заполните карточку и добавьте или удалите фото и PDF. Время уведомлений задаётся в настройках.'}</DialogDescription></DialogHeader>
        <div className="space-y-4"><div className="space-y-2"><label htmlFor="reminder-name" className="text-sm font-medium">Имя и фамилия</label><Input id="reminder-name" value={fullName} onChange={event => setFullName(event.target.value)} /></div><div className="space-y-2"><label htmlFor="reminder-contact" className="text-sm font-medium">Телефон или конто</label><Input id="reminder-contact" value={contact} onChange={event => setContact(event.target.value)} /></div><div className="space-y-2"><label htmlFor="reminder-text" className="text-sm font-medium">Текст напоминания</label><Textarea id="reminder-text" value={message} onChange={event => setMessage(event.target.value)} rows={5} /></div>{isArchivePdfReminder && <><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="pdf-payment-start-date" className="text-sm font-medium">Когда</label><Input id="pdf-payment-start-date" type="date" value={pdfStartDate} onChange={event => setPdfStartDate(event.target.value)} /></div><div className="space-y-2"><label htmlFor="pdf-payment-repeat" className="text-sm font-medium">Как часто</label><select id="pdf-payment-repeat" value={pdfRepeat} onChange={event => setPdfRepeat(event.target.value as Repeat)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="once">Один раз</option><option value="weekly">Раз в неделю</option><option value="monthly">Раз в месяц</option><option value="yearly">Раз в год</option></select></div></div><p className="text-xs text-muted-foreground">Эта дата станет основной датой PDF и будет началом подсчёта выплат.</p><div className="space-y-2"><label htmlFor="reminder-archive-pdf" className="text-sm font-medium">PDF из архива</label><select id="reminder-archive-pdf" value={selectedArchivedPdfPath} onChange={event => { const path = event.target.value; setSelectedArchivedPdfPath(path); const pdf = archivedPdfs.find(item => item.path === path); if (pdf) { setPaymentAmount(String(pdf.amount)); setPaymentCurrency(pdf.currency === 'EUR' || pdf.currency === 'USD' ? pdf.currency : 'PLN'); } }} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Выберите PDF</option>{archivedPdfs.map(pdf => <option key={pdf.path} value={pdf.path}>{pdf.label}</option>)}</select>{archivedPdfs.length === 0 && <p className="text-xs text-muted-foreground">В PDF-архиве пока нет документов с сохранённым файлом.</p>}</div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label htmlFor="payment-amount" className="text-sm font-medium">Сумма ежемесячной выплаты</label><Input id="payment-amount" inputMode="decimal" placeholder="Например, 1000" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} /></div><div className="space-y-2"><label htmlFor="payment-currency" className="text-sm font-medium">Валюта выплаты</label><select id="payment-currency" value={paymentCurrency} onChange={event => setPaymentCurrency(event.target.value as 'PLN' | 'EUR' | 'USD')} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="PLN">Польский злотый (PLN)</option><option value="EUR">Евро (EUR)</option><option value="USD">Доллар США (USD)</option></select></div></div></>}<div className="space-y-2"><label htmlFor="reminder-files" className="text-sm font-medium">Добавить фото и PDF</label><Input id="reminder-files" type="file" accept="image/*,application/pdf" multiple onChange={chooseFiles} />{existingAttachments.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">{existingAttachments.map(item => <li className="flex items-center justify-between gap-2" key={item.path}><span className="truncate">{item.name}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeExistingAttachment(item)} aria-label={`Удалить ${item.name}`}><X className="h-4 w-4" /></Button></li>)}</ul>}{files.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">{files.map(file => <li className="flex items-center justify-between gap-2" key={`${file.name}-${file.lastModified}`}><span className="truncate">{file.name}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeNewFile(file)} aria-label={`Удалить ${file.name}`}><X className="h-4 w-4" /></Button></li>)}</ul>}</div></div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => void saveReminder()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? 'Сохранить' : 'Создать'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Настройки уведомлений</DialogTitle>
          <DialogDescription>Дата, время и периодичность едины для всех текущих и новых обычных карточек. У PDF-карточек дата и периодичность задаются отдельно.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2"><label htmlFor="global-reminder-date" className="text-sm font-medium">Когда</label><Input id="global-reminder-date" type="date" value={reminderDate} onChange={event => setReminderDate(event.target.value)} /></div>
          <div className="space-y-2"><label htmlFor="global-reminder-time" className="text-sm font-medium">Во сколько</label><Input id="global-reminder-time" type="time" value={reminderTime} onChange={event => setReminderTime(event.target.value)} /></div>
          <div className="space-y-2"><label htmlFor="global-reminder-repeat" className="text-sm font-medium">Как часто</label><select id="global-reminder-repeat" value={repeat} onChange={event => setRepeat(event.target.value as Repeat)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="once">Один раз</option><option value="weekly">Раз в неделю</option><option value="monthly">Раз в месяц</option><option value="yearly">Раз в год</option></select></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setSettingsOpen(false)}>Отмена</Button><Button onClick={() => void saveSettings()} disabled={savingSettings}>{savingSettings && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Сохранить</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(reminderToClose)} onOpenChange={(value) => { if (!value) setReminderToClose(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Завершить выплату</DialogTitle><DialogDescription>Выберите дату окончания. Она будет добавлена через тире к основной дате в PDF, а карточка будет закрыта.</DialogDescription></DialogHeader>
        <div className="space-y-2"><label htmlFor="payment-end-date" className="text-sm font-medium">Дата завершения</label><Input id="payment-end-date" type="date" value={paymentEndDate} onChange={event => setPaymentEndDate(event.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={() => setReminderToClose(null)}>Отмена</Button><Button variant="destructive" disabled={!reminderToClose || closingId === reminderToClose.id} onClick={() => { if (!reminderToClose) return; void closeRecurringPdfReminder(reminderToClose, paymentEndDate).then(() => setReminderToClose(null)); }}>{closingId === reminderToClose?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Завершить выплату</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(preview)} onOpenChange={(value) => { if (!value) { setPreview(null); setPreviewUrls({}); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{preview?.metadata?.full_name || preview?.title}</DialogTitle><DialogDescription>{preview?.metadata?.contact}</DialogDescription></DialogHeader>{preview && <div className="space-y-4"><p className="whitespace-pre-wrap">{preview.message}</p>{(preview.metadata?.attachments || []).length === 0 ? <p className="text-muted-foreground">Вложений нет.</p> : <div className="grid gap-3 sm:grid-cols-2">{(preview.metadata?.attachments || []).map(attachment => <div key={attachment.path} className="overflow-hidden rounded-lg border p-2">{isImage(attachment) ? <img src={previewUrls[attachment.path]} alt={attachment.name} className="max-h-72 w-full rounded object-contain" /> : <FileText className="mx-auto my-8 h-12 w-12 text-primary" />}<a className="mt-2 block truncate text-sm text-primary underline" href={previewUrls[attachment.path]} target="_blank" rel="noopener noreferrer">{attachment.name}</a></div>)}</div>}</div>}</DialogContent>
    </Dialog>
  </section>;
};
