import { useEffect, useMemo, useState } from 'react';
import { Bot, CalendarDays, ChevronDown, ChevronUp, Loader2, Plus, Send, Trash2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

interface RegistrationEvent {
  id: string;
  title: string;
  description: string;
  starts_at: string | null;
  capacity: number | null;
  button_text: string;
  confirmation_text: string;
  is_published: boolean;
  created_at: string;
  event_registrations?: RegistrationEntry[];
}

interface RegistrationEntry {
  id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  telegram_user_id: number;
  registered_at: string;
}

const emptyForm = {
  title: '',
  description: '',
  startsAt: '',
  capacity: '',
  buttonText: 'Зарегистрироваться',
  confirmationText: 'Регистрация подтверждена!',
};

export function RegistrationBuilder() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [events, setEvents] = useState<RegistrationEvent[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const database = supabase as any;

  const loadEvents = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await database
      .from('registration_events')
      .select('*, event_registrations(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (error) {
      toast({ title: 'Не удалось загрузить мероприятия', description: error.message, variant: 'destructive' });
    } else {
      setEvents((data || []) as RegistrationEvent[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadEvents();
  }, [user]);

  const createEvent = async () => {
    if (!user || !form.title.trim()) {
      toast({ title: 'Введите название мероприятия', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await database.from('registration_events').insert({
      user_id: user.id,
      title: form.title.trim(),
      description: form.description.trim(),
      starts_at: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      capacity: form.capacity ? Math.max(1, Number(form.capacity)) : null,
      button_text: form.buttonText.trim() || 'Зарегистрироваться',
      confirmation_text: form.confirmationText.trim() || 'Регистрация подтверждена!',
      is_published: false,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Ошибка создания', description: error.message, variant: 'destructive' });
      return;
    }
    setForm(emptyForm);
    toast({ title: 'Мероприятие создано', description: 'Опубликуйте его, чтобы кнопка появилась в Telegram-боте.' });
    await loadEvents();
  };

  const togglePublished = async (event: RegistrationEvent) => {
    const { error } = await database
      .from('registration_events')
      .update({ is_published: !event.is_published })
      .eq('id', event.id);
    if (error) {
      toast({ title: 'Ошибка публикации', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: event.is_published ? 'Мероприятие скрыто' : 'Мероприятие опубликовано в Telegram-боте' });
    await loadEvents();
  };

  const deleteEvent = async (id: string) => {
    if (!window.confirm('Удалить мероприятие и все регистрации?')) return;
    const { error } = await database.from('registration_events').delete().eq('id', id);
    if (error) {
      toast({ title: 'Ошибка удаления', description: error.message, variant: 'destructive' });
      return;
    }
    await loadEvents();
  };

  const totalRegistrations = useMemo(
    () => events.reduce((sum, event) => sum + (event.event_registrations?.length || 0), 0),
    [events],
  );

  if (loading) {
    return <div className="flex items-center gap-2 py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Загрузка конструктора…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <h3 className="text-xl font-bold">Конструктор регистрации</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Создавайте мероприятия и принимайте регистрации через подключённый Telegram-бот.
          </p>
        </div>
        <div className="rounded-lg border px-3 py-2 text-sm">
          <Users className="mr-2 inline h-4 w-4" />Всего регистраций: {totalRegistrations}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Новое мероприятие</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="registration-title">Название</Label>
            <Input id="registration-title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Например: Молодёжная конференция" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="registration-description">Описание</Label>
            <Textarea id="registration-description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Место, программа и важная информация" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-date">Дата и время</Label>
            <Input id="registration-date" type="datetime-local" value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-capacity">Количество мест</Label>
            <Input id="registration-capacity" type="number" min="1" value={form.capacity} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="Без ограничений" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-button">Текст кнопки в боте</Label>
            <Input id="registration-button" value={form.buttonText} onChange={e => setForm({ ...form, buttonText: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="registration-confirmation">Сообщение после регистрации</Label>
            <Input id="registration-confirmation" value={form.confirmationText} onChange={e => setForm({ ...form, confirmationText: e.target.value })} />
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground sm:col-span-2">
            Бот автоматически сохранит имя, фамилию, username и Telegram ID участника. Один человек может зарегистрироваться на мероприятие только один раз.
          </div>
          <Button onClick={createEvent} disabled={saving} className="sm:col-span-2">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Создать мероприятие
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {events.length === 0 && <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Мероприятий пока нет.</div>}
        {events.map(event => {
          const registrations = event.event_registrations || [];
          return (
            <Card key={event.id}>
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                    <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{event.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {event.starts_at ? new Date(event.starts_at).toLocaleString('ru-RU') : 'Дата не указана'} · {registrations.length}{event.capacity ? ` / ${event.capacity}` : ''} участников
                      </p>
                    </div>
                    {expanded === event.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  <div className="flex gap-2">
                    <Button variant={event.is_published ? 'secondary' : 'default'} size="sm" onClick={() => togglePublished(event)}>
                      <Send className="mr-2 h-4 w-4" />{event.is_published ? 'Скрыть' : 'Опубликовать'}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => deleteEvent(event.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                </div>
                {expanded === event.id && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    {event.description && <p className="text-sm">{event.description}</p>}
                    <div className="rounded-lg border">
                      {registrations.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">Регистраций ещё нет.</p>
                      ) : registrations.map(entry => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 border-b p-3 last:border-b-0">
                          <div>
                            <p className="font-medium">{[entry.first_name, entry.last_name].filter(Boolean).join(' ') || `Telegram ${entry.telegram_user_id}`}</p>
                            <p className="text-xs text-muted-foreground">{entry.username ? `@${entry.username}` : 'username не указан'}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">{new Date(entry.registered_at).toLocaleString('ru-RU')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
