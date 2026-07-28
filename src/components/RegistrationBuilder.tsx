import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarDays, CheckCircle2, ChevronDown, ChevronUp, Loader2, Plus, Send, Trash2, Users, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type FieldType = 'text' | 'phone' | 'email' | 'number';
type FormField = { id: string; label: string; type: FieldType; required: boolean };
type ConnectedBot = { id: string; telegram_chat_id: number; bot_token: string | null };
type RegistrationEntry = {
  id: string; first_name: string | null; last_name: string | null; username: string | null;
  telegram_user_id: number; registered_at: string; answers: Record<string, string>;
  payment_status: 'not_required' | 'pending' | 'paid';
};
type RegistrationEvent = {
  id: string; title: string; description: string; starts_at: string | null; capacity: number | null;
  button_text: string; confirmation_text: string; is_published: boolean; created_at: string;
  form_fields: FormField[]; payment_required: boolean; price: number | null; currency: string;
  payment_instructions: string; payment_url: string | null; telegram_bot_ids: string[];
  event_registrations?: RegistrationEntry[];
};

const defaultFields: FormField[] = [
  { id: 'first_name', label: 'Имя', type: 'text', required: true },
  { id: 'last_name', label: 'Фамилия', type: 'text', required: true },
  { id: 'phone', label: 'Номер телефона', type: 'phone', required: true },
  { id: 'email', label: 'Email', type: 'email', required: true },
];
const presets: Array<[string, string, FieldType]> = [
  ['age', 'Возраст', 'number'], ['city', 'Город', 'text'], ['church', 'Церковь', 'text'],
  ['address', 'Адрес', 'text'], ['diet', 'Питание / аллергии', 'text'], ['comment', 'Комментарий', 'text'],
];
const initialForm = {
  title: '', description: '', startsAt: '', capacity: '', buttonText: 'Зарегистрироваться',
  confirmationText: 'Регистрация подтверждена!', fields: defaultFields, customField: '',
  paymentRequired: false, price: '', currency: 'PLN', paymentInstructions: '', paymentUrl: '',
  botIds: [] as string[],
};

export function RegistrationBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = supabase as any;
  const [events, setEvents] = useState<RegistrationEvent[]>([]);
  const [bots, setBots] = useState<ConnectedBot[]>([]);
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [eventResult, botResult] = await Promise.all([
      db.from('registration_events').select('*, event_registrations(*)').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('telegram_users').select('id, telegram_chat_id, bot_token').eq('user_id', user.id).eq('is_active', true),
    ]);
    if (eventResult.error) toast({ title: 'Не удалось загрузить мероприятия', description: eventResult.error.message, variant: 'destructive' });
    setEvents((eventResult.data || []) as RegistrationEvent[]);
    setBots((botResult.data || []) as ConnectedBot[]);
    setLoading(false);
  };
  useEffect(() => { void load(); }, [user]);

  const addField = (id: string, label: string, type: FieldType) => {
    if (!label.trim() || form.fields.some(field => field.id === id)) return;
    setForm({ ...form, fields: [...form.fields, { id, label: label.trim(), type, required: false }], customField: '' });
  };
  const removeField = (id: string) => setForm({ ...form, fields: form.fields.filter(field => field.id !== id) });
  const toggleBot = (id: string) => setForm({
    ...form,
    botIds: form.botIds.includes(id) ? form.botIds.filter(item => item !== id) : [...form.botIds, id],
  });

  const createEvent = async () => {
    if (!user || !form.title.trim()) {
      toast({ title: 'Введите название мероприятия', variant: 'destructive' }); return;
    }
    if (!form.fields.length) {
      toast({ title: 'Добавьте хотя бы одно поле анкеты', variant: 'destructive' }); return;
    }
    if (form.paymentRequired && (!form.price || Number(form.price) <= 0)) {
      toast({ title: 'Укажите стоимость мероприятия', variant: 'destructive' }); return;
    }
    setSaving(true);
    const { error } = await db.from('registration_events').insert({
      user_id: user.id, title: form.title.trim(), description: form.description.trim(),
      starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      capacity: form.capacity ? Math.max(1, Number(form.capacity)) : null,
      button_text: form.buttonText.trim() || 'Зарегистрироваться',
      confirmation_text: form.confirmationText.trim() || 'Регистрация подтверждена!',
      form_fields: form.fields, payment_required: form.paymentRequired,
      price: form.paymentRequired ? Number(form.price) : null, currency: form.currency.trim().toUpperCase() || 'PLN',
      payment_instructions: form.paymentInstructions.trim(), payment_url: form.paymentUrl.trim() || null,
      telegram_bot_ids: form.botIds, is_published: false,
    });
    setSaving(false);
    if (error) { toast({ title: 'Ошибка создания', description: error.message, variant: 'destructive' }); return; }
    setForm(initialForm);
    toast({ title: 'Мероприятие создано', description: 'Опубликуйте его, чтобы кнопка появилась в выбранных ботах.' });
    await load();
  };
  const updateEvent = async (id: string, values: Record<string, unknown>) => {
    const { error } = await db.from('registration_events').update(values).eq('id', id);
    if (error) toast({ title: 'Ошибка сохранения', description: error.message, variant: 'destructive' });
    else await load();
  };
  const removeEvent = async (id: string) => {
    if (!window.confirm('Удалить мероприятие и все регистрации?')) return;
    await db.from('registration_events').delete().eq('id', id); await load();
  };
  const markPaid = async (id: string) => {
    const { error } = await db.from('event_registrations').update({ payment_status: 'paid' }).eq('id', id);
    if (error) toast({ title: 'Не удалось подтвердить оплату', description: error.message, variant: 'destructive' });
    else await load();
  };
  const total = useMemo(() => events.reduce((sum, event) => sum + (event.event_registrations?.length || 0), 0), [events]);
  if (loading) return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка конструктора…</div>;

  return <div className="space-y-6">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="flex items-center gap-2"><Bot className="h-6 w-6 text-primary" /><h3 className="text-xl font-bold">Конструктор регистрации</h3></div>
        <p className="mt-1 text-sm text-muted-foreground">Создавайте анкеты, принимайте оплату и назначайте мероприятие одному или нескольким Telegram-ботам.</p></div>
      <div className="rounded-lg border px-3 py-2 text-sm"><Users className="mr-2 inline h-4 w-4" />Всего регистраций: {total}</div>
    </div>
    <Card><CardHeader><CardTitle className="text-lg">Новое мероприятие</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2"><Label>Название</Label><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Например: Молодёжная конференция" /></div>
        <div className="space-y-2 sm:col-span-2"><Label>Описание</Label><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Место, программа и важная информация" /></div>
        <div className="space-y-2"><Label>Дата и время</Label><Input type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></div>
        <div className="space-y-2"><Label>Количество мест</Label><Input type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Без ограничений" /></div>

        <div className="space-y-3 rounded-lg border p-4 sm:col-span-2">
          <div><Label className="text-base">Поля анкеты</Label><p className="text-sm text-muted-foreground">Бот последовательно запросит выбранные данные.</p></div>
          <div className="flex flex-wrap gap-2">{form.fields.map(field =>
            <div key={field.id} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <input type="checkbox" checked={field.required} onChange={e => setForm({ ...form, fields: form.fields.map(item => item.id === field.id ? { ...item, required: e.target.checked } : item) })} />
              <span>{field.label}{field.required ? ' *' : ''}</span><button type="button" onClick={() => removeField(field.id)}><X className="h-3 w-3" /></button>
            </div>)}</div>
          <div className="flex flex-wrap gap-2">{presets.filter(([id]) => !form.fields.some(field => field.id === id)).map(([id, label, type]) =>
            <Button key={id} type="button" size="sm" variant="outline" onClick={() => addField(id, label, type)}><Plus className="mr-1 h-3 w-3" />{label}</Button>)}</div>
          <div className="flex gap-2"><Input value={form.customField} onChange={e => setForm({ ...form, customField: e.target.value })} placeholder="Своё поле, например: Размер футболки" />
            <Button type="button" variant="outline" onClick={() => addField(`custom_${Date.now()}`, form.customField, 'text')}>Добавить</Button></div>
        </div>

        <div className="space-y-3 rounded-lg border p-4 sm:col-span-2">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={form.paymentRequired} onChange={e => setForm({ ...form, paymentRequired: e.target.checked })} />Платное мероприятие</label>
          {form.paymentRequired && <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Стоимость</Label><Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} /></div>
            <div><Label>Валюта</Label><Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Ссылка на оплату</Label><Input type="url" value={form.paymentUrl} onChange={e => setForm({ ...form, paymentUrl: e.target.value })} placeholder="https://…" /></div>
            <div className="sm:col-span-2"><Label>Инструкция для оплаты</Label><Textarea value={form.paymentInstructions} onChange={e => setForm({ ...form, paymentInstructions: e.target.value })} placeholder="Реквизиты, назначение платежа или другая инструкция" /></div>
          </div>}
        </div>

        <div className="space-y-2 rounded-lg border p-4 sm:col-span-2"><Label className="text-base">Telegram-боты</Label>
          <p className="text-sm text-muted-foreground">Если ничего не выбрано, мероприятие появится во всех ваших ботах.</p>
          <div className="flex flex-wrap gap-2">{bots.length ? bots.map((bot, index) =>
            <label key={bot.id} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"><input type="checkbox" checked={form.botIds.includes(bot.id)} onChange={() => toggleBot(bot.id)} />
              {bot.bot_token ? `Свой бот ${index + 1}` : `Общий бот ${index + 1}`} · Chat ID {bot.telegram_chat_id}</label>
          ) : <p className="text-sm text-amber-500">Сначала подключите хотя бы одного бота в разделе Telegram-бот.</p>}</div>
        </div>
        <div className="space-y-2"><Label>Текст кнопки в боте</Label><Input value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} /></div>
        <div className="space-y-2"><Label>Сообщение после регистрации</Label><Input value={form.confirmationText} onChange={e => setForm({ ...form, confirmationText: e.target.value })} /></div>
        <Button onClick={createEvent} disabled={saving} className="sm:col-span-2">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Создать мероприятие</Button>
      </CardContent>
    </Card>
    <div className="space-y-3">{events.map(event => {
      const registrations = event.event_registrations || [];
      return <Card key={event.id}><CardContent className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
            <CalendarDays className="h-5 w-5 text-primary" /><div className="min-w-0"><p className="truncate font-semibold">{event.title}</p>
              <p className="text-sm text-muted-foreground">{event.starts_at ? new Date(event.starts_at).toLocaleString('ru-RU') : 'Дата не указана'} · {registrations.length}{event.capacity ? ` / ${event.capacity}` : ''} участников{event.payment_required ? ` · ${event.price} ${event.currency}` : ''}</p></div>
            {expanded === event.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button><div className="flex gap-2"><Button variant={event.is_published ? 'secondary' : 'default'} size="sm" onClick={() => updateEvent(event.id, { is_published: !event.is_published })}><Send className="mr-2 h-4 w-4" />{event.is_published ? 'Скрыть' : 'Опубликовать'}</Button>
            <Button variant="ghost" size="icon" onClick={() => removeEvent(event.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>
        </div>
        {expanded === event.id && <div className="mt-4 space-y-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">Поля: {(event.form_fields || []).map(field => field.label).join(', ')}</p>
          {registrations.length === 0 ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">Регистраций ещё нет.</p> : registrations.map(entry =>
            <div key={entry.id} className="rounded-lg border p-3"><div className="flex flex-col justify-between gap-2 sm:flex-row">
              <div><p className="font-medium">{[entry.first_name, entry.last_name].filter(Boolean).join(' ') || `Telegram ${entry.telegram_user_id}`}</p>
                <p className="text-xs text-muted-foreground">{Object.entries(entry.answers || {}).map(([key, value]) => `${key}: ${value}`).join(' · ')}</p></div>
              <div className="flex items-center gap-2">{entry.payment_status === 'pending' && <Button size="sm" variant="outline" onClick={() => markPaid(entry.id)}><CheckCircle2 className="mr-1 h-4 w-4" />Подтвердить оплату</Button>}
                <span className="text-xs text-muted-foreground">{entry.payment_status === 'paid' ? 'Оплачено' : entry.payment_status === 'pending' ? 'Ожидает оплаты' : 'Бесплатно'}</span></div>
            </div></div>)}
        </div>}
      </CardContent></Card>;
    })}</div>
  </div>;
}
