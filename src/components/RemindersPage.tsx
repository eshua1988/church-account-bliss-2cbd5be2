import { ChangeEvent, useEffect, useState } from 'react';
import { Bell, CalendarDays, FileText, Loader2, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type Attachment = { path: string; name: string; type: string };
type Repeat = 'once' | 'weekly' | 'monthly' | 'yearly';
type Reminder = {
  id: string;
  title: string;
  message: string;
  created_at: string;
  metadata: { full_name?: string; contact?: string; attachments?: Attachment[]; reminder_date?: string; reminder_time?: string; repeat?: Repeat } | null;
};

const safeFileName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_');
const isImage = (attachment: Attachment) => attachment.type.startsWith('image/');
const repeatLabel: Record<Repeat, string> = { once: 'Один раз', weekly: 'Раз в неделю', monthly: 'Раз в месяц', yearly: 'Раз в год' };
const today = () => new Date().toISOString().slice(0, 10);
const remindersTable = () => supabase.from('reminders' as any) as any;
const fromRow = (row: any): Reminder => ({
  id: row.id,
  title: row.full_name,
  message: row.message,
  created_at: row.created_at,
  metadata: { full_name: row.full_name, contact: row.contact, attachments: row.attachments || [], reminder_date: row.reminder_date, reminder_time: String(row.reminder_time || '09:00').slice(0, 5), repeat: row.repeat },
});

export const RemindersPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const [reminderDate, setReminderDate] = useState(today());
  const [reminderTime, setReminderTime] = useState('09:00');
  const [repeat, setRepeat] = useState<Repeat>('once');

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await remindersTable()
      .select('id, full_name, contact, message, attachments, reminder_date, reminder_time, repeat, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) toast({ title: 'Не удалось загрузить напоминания', description: error.message, variant: 'destructive' });
    else setReminders((data || []).map(fromRow));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user]);

  const resetForm = () => {
    setFullName('');
    setContact('');
    setMessage('');
    setFiles([]);
    setExistingAttachments([]);
    setRemovedAttachmentPaths([]);
    setEditing(null);
    setReminderDate(today());
    setReminderTime('09:00');
    setRepeat('once');
  };

  const openNewReminder = () => {
    resetForm();
    setOpen(true);
  };

  const openEditReminder = (reminder: Reminder) => {
    setEditing(reminder);
    setFullName(reminder.metadata?.full_name || reminder.title);
    setContact(reminder.metadata?.contact || '');
    setMessage(reminder.message);
    setExistingAttachments(reminder.metadata?.attachments || []);
    setFiles([]);
    setReminderDate(reminder.metadata?.reminder_date || today());
    setReminderTime(reminder.metadata?.reminder_time || '09:00');
    setRepeat(reminder.metadata?.repeat || 'once');
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

    setSaving(true);
    const uploadedPaths: string[] = [];
    try {
      const attachments: Attachment[] = [...existingAttachments];
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
        reminder_date: reminderDate,
        reminder_time: reminderTime,
        repeat,
      };
      const { error } = editing
        ? await remindersTable().update(values).eq('id', editing.id)
        : await remindersTable().insert({ ...values, user_id: user.id });
      if (error) throw error;
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
    setRemovedAttachmentPaths(previous => [...previous, attachment.path]);
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
    if (attachments.length) await supabase.storage.from('documents').remove(attachments.map(item => item.path));
    setReminders(previous => previous.filter(item => item.id !== reminder.id));
    toast({ title: 'Напоминание удалено' });
  };

  return <section className="animate-fade-in mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Напоминания</h1><p className="text-muted-foreground">Выберите дату, повторение и сохраните контакт с файлами в одной карточке.</p></div>
      <Button className="gap-2" onClick={openNewReminder}><Plus className="h-4 w-4" />Добавить напоминание</Button>
    </div>

    {loading ? <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div> : reminders.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Напоминаний пока нет.</div> : <div className="grid gap-4 sm:grid-cols-2">{reminders.map(reminder => {
      const attachments = reminder.metadata?.attachments || [];
      return <article key={reminder.id} className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-semibold">{reminder.metadata?.full_name || reminder.title}</h2><p className="text-sm text-muted-foreground break-words">{reminder.metadata?.contact || 'Контакт не указан'}</p></div><Bell className="h-5 w-5 shrink-0 text-primary" /></div>
        <p className="mt-3 whitespace-pre-wrap text-sm">{reminder.message}</p>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="h-3.5 w-3.5" />{reminder.metadata?.reminder_date ? new Date(`${reminder.metadata.reminder_date}T12:00:00`).toLocaleDateString('ru-RU') : 'Дата не указана'} в {reminder.metadata?.reminder_time || '09:00'} · {repeatLabel[reminder.metadata?.repeat || 'once']}</p>
        <p className="mt-1 text-xs text-muted-foreground">Вложений: {attachments.length} · создано {new Date(reminder.created_at).toLocaleDateString('ru-RU')}</p>
        <div className="mt-4 flex gap-2"><Button variant="outline" className="flex-1 gap-2" onClick={() => void openPreview(reminder)}><Paperclip className="h-4 w-4" />Просмотреть</Button><Button variant="ghost" size="icon" onClick={() => openEditReminder(reminder)} aria-label="Редактировать напоминание"><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => void deleteReminder(reminder)} aria-label="Удалить напоминание"><Trash2 className="h-4 w-4" /></Button></div>
      </article>;
    })}</div>}

    <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) resetForm(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editing ? 'Редактировать напоминание' : 'Новое напоминание'}</DialogTitle><DialogDescription>Выберите дату и периодичность, а также добавьте или удалите фото и PDF.</DialogDescription></DialogHeader>
        <div className="space-y-4"><div className="space-y-2"><label htmlFor="reminder-name" className="text-sm font-medium">Имя и фамилия</label><Input id="reminder-name" value={fullName} onChange={event => setFullName(event.target.value)} /></div><div className="space-y-2"><label htmlFor="reminder-contact" className="text-sm font-medium">Телефон или конто</label><Input id="reminder-contact" value={contact} onChange={event => setContact(event.target.value)} /></div><div className="grid gap-4 sm:grid-cols-3"><div className="space-y-2"><label htmlFor="reminder-date" className="text-sm font-medium">Когда</label><Input id="reminder-date" type="date" value={reminderDate} onChange={event => setReminderDate(event.target.value)} /></div><div className="space-y-2"><label htmlFor="reminder-time" className="text-sm font-medium">Во сколько</label><Input id="reminder-time" type="time" value={reminderTime} onChange={event => setReminderTime(event.target.value)} /></div><div className="space-y-2"><label htmlFor="reminder-repeat" className="text-sm font-medium">Как часто</label><select id="reminder-repeat" value={repeat} onChange={event => setRepeat(event.target.value as Repeat)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"><option value="once">Один раз</option><option value="weekly">Раз в неделю</option><option value="monthly">Раз в месяц</option><option value="yearly">Раз в год</option></select></div></div><div className="space-y-2"><label htmlFor="reminder-text" className="text-sm font-medium">Текст напоминания</label><Textarea id="reminder-text" value={message} onChange={event => setMessage(event.target.value)} rows={5} /></div><div className="space-y-2"><label htmlFor="reminder-files" className="text-sm font-medium">Добавить фото и PDF</label><Input id="reminder-files" type="file" accept="image/*,application/pdf" multiple onChange={chooseFiles} />{existingAttachments.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">{existingAttachments.map(item => <li className="flex items-center justify-between gap-2" key={item.path}><span className="truncate">{item.name}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeExistingAttachment(item)} aria-label={`Удалить ${item.name}`}><X className="h-4 w-4" /></Button></li>)}</ul>}{files.length > 0 && <ul className="space-y-1 text-sm text-muted-foreground">{files.map(file => <li className="flex items-center justify-between gap-2" key={`${file.name}-${file.lastModified}`}><span className="truncate">{file.name}</span><Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeNewFile(file)} aria-label={`Удалить ${file.name}`}><X className="h-4 w-4" /></Button></li>)}</ul>}</div></div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button onClick={() => void saveReminder()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? 'Сохранить' : 'Создать'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(preview)} onOpenChange={(value) => { if (!value) { setPreview(null); setPreviewUrls({}); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{preview?.metadata?.full_name || preview?.title}</DialogTitle><DialogDescription>{preview?.metadata?.contact}</DialogDescription></DialogHeader>{preview && <div className="space-y-4"><p className="whitespace-pre-wrap">{preview.message}</p>{(preview.metadata?.attachments || []).length === 0 ? <p className="text-muted-foreground">Вложений нет.</p> : <div className="grid gap-3 sm:grid-cols-2">{(preview.metadata?.attachments || []).map(attachment => <div key={attachment.path} className="overflow-hidden rounded-lg border p-2">{isImage(attachment) ? <img src={previewUrls[attachment.path]} alt={attachment.name} className="max-h-72 w-full rounded object-contain" /> : <FileText className="mx-auto my-8 h-12 w-12 text-primary" />}<a className="mt-2 block truncate text-sm text-primary underline" href={previewUrls[attachment.path]} target="_blank" rel="noopener noreferrer">{attachment.name}</a></div>)}</div>}</div>}</DialogContent>
    </Dialog>
  </section>;
};
