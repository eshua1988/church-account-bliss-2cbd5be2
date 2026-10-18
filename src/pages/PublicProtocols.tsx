import { FormEvent, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { Archive, Bell, Download, FileDown, FileText, Loader2, Plus, Settings, Table2, Users } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ROBOTO_FONT_BASE64 } from '@/lib/robotoFont';

const today = () => new Date().toISOString().slice(0, 10);
const councils = { elders: 'Пресвитерского совета', church: 'Церковного совета' } as const;
type Council = keyof typeof councils;
type Section = 'create' | 'settings' | 'notifications';
type Protocol = { id: string; title: string; createdAt: string; date: string; council: Council; present: string[]; content: string; pdf: string; archived: boolean };
type ProtocolSettings = { people: string[]; googleSheetUrl: string; cloudName: string };
const emptySettings: ProtocolSettings = { people: [], googleSheetUrl: '', cloudName: '' };

const bytesToBase64 = (bytes: Uint8Array) => { let value = ''; for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000)); return btoa(value); };
const base64ToBlob = (value: string) => new Blob([Uint8Array.from(atob(value), char => char.charCodeAt(0))], { type: 'application/pdf' });
const download = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); };

const PublicProtocols = () => {
  const { token = '' } = useParams();
  const [valid, setValid] = useState<boolean | null>(null);
  const [section, setSection] = useState<Section>('create');
  const [notificationTab, setNotificationTab] = useState<'main' | 'archive'>('main');
  const [saving, setSaving] = useState(false);
  const [council, setCouncil] = useState<Council>('church');
  const [date, setDate] = useState(today());
  const [place, setPlace] = useState('');
  const [present, setPresent] = useState<string[]>([]);
  const [content, setContent] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newPerson, setNewPerson] = useState('');
  const [settings, setSettings] = useState<ProtocolSettings>(emptySettings);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = `public-protocols:${token}`;

  useEffect(() => {
    supabase.from('shared_transaction_links').select('id, name').eq('token', token).eq('is_active', true).maybeSingle()
      .then(({ data }) => setValid(Boolean(data?.name?.startsWith('[Протоколы]'))));
  }, [token]);
  useEffect(() => {
    setHydrated(false);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setSettings({ ...emptySettings, ...(saved.settings || {}) });
      setProtocols(Array.isArray(saved.protocols) ? saved.protocols : []);
    } catch { setSettings(emptySettings); setProtocols([]); }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => { if (!hydrated) return; try { localStorage.setItem(storageKey, JSON.stringify({ settings, protocols })); } catch { /* Browser storage can be disabled. */ } }, [settings, protocols, storageKey, hydrated]);

  const activeProtocols = useMemo(() => protocols.filter(item => !item.archived), [protocols]);
  const archivedProtocols = useMemo(() => protocols.filter(item => item.archived), [protocols]);
  const togglePerson = (name: string) => setPresent(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name]);
  const addPerson = () => { const name = newPerson.trim(); if (!name) return; setSettings(current => ({ ...current, people: current.people.includes(name) ? current.people : [...current.people, name] })); setNewPerson(''); };

  const makePdf = async (event: FormEvent) => {
    event.preventDefault();
    if (!present.length || !content.trim()) return;
    setSaving(true);
    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), char => char.charCodeAt(0)));
      const margin = 52; let page = pdf.addPage([595.28, 841.89]); let y = 790;
      const newPage = () => { page = pdf.addPage([595.28, 841.89]); y = 790; };
      const text = (value: string, size = 11, gap = 6) => {
        let line = '';
        for (const word of value.trim().split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next, size) > 595.28 - margin * 2 && line) { if (y < 70) newPage(); page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) }); y -= size + gap; line = word; } else line = next; }
        if (line) { if (y < 70) newPage(); page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) }); y -= size + gap; }
      };
      const heading = (value: string, size: number) => { page.drawText(value, { x: (595.28 - font.widthOfTextAtSize(value, size)) / 2, y, size, font }); y -= size + 18; };
      heading('ПРОТОКОЛ', 18); heading(councils[council].toUpperCase(), 14);
      text(`Дата: ${new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU')}`); text(`Место: ${place.trim() || 'Не указано'}`); text(`Присутствовали: ${present.join(', ')}`);
      y -= 12; page.drawLine({ start: { x: margin, y }, end: { x: 595.28 - margin, y }, thickness: 1, color: rgb(.45, .45, .45) }); y -= 26;
      content.split(/\n+/).forEach(paragraph => { text(paragraph, 12, 8); y -= 8; }); if (y < 105) newPage(); y -= 30; text(`Секретарь ${councils[council]}: ____________________`);
      const bytes = await pdf.save(); const filename = `Протокол_${council === 'elders' ? 'Пресвитерского' : 'Церковного'}_совета_${date}.pdf`;
      const protocol: Protocol = { id: crypto.randomUUID(), title: filename, createdAt: new Date().toISOString(), date, council, present, content, pdf: bytesToBase64(bytes), archived: false };
      setProtocols(current => [protocol, ...current]); download(new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename);
      setContent(''); setPresent([]); setSection('notifications'); setNotificationTab('main');
    } finally { setSaving(false); }
  };
  const saveGoogleRow = async (item: Protocol) => { const row = [item.date, councils[item.council], item.present.join(', '), item.content.replace(/\n/g, ' ')].join('\t'); await navigator.clipboard.writeText(row); if (settings.googleSheetUrl) window.open(settings.googleSheetUrl, '_blank', 'noopener,noreferrer'); };
  const makeArchive = async () => { const zip = new JSZip(); archivedProtocols.forEach(item => zip.file(item.title, base64ToBlob(item.pdf))); download(await zip.generateAsync({ type: 'blob' }), `Архив_протоколов_${today()}.zip`); };

  if (valid === null) return <main className="grid min-h-screen place-items-center">Загрузка…</main>;
  if (!valid) return <main className="grid min-h-screen place-items-center text-destructive">Ссылка не найдена или отключена.</main>;
  const nav = (id: Section, label: string, Icon: typeof FileText) => <button onClick={() => setSection(id)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${section === id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Icon className="h-4 w-4" />{label}</button>;
  const protocolList = (items: Protocol[], archive: boolean) => <div className="space-y-3">{items.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{archive ? 'В архиве пока нет протоколов.' : 'Сохранённые PDF-протоколы появятся здесь.'}</p> : items.map(item => <article key={item.id} className="rounded-lg border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{item.title}</p><p className="text-sm text-muted-foreground">{new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU')} · {councils[item.council]}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => download(base64ToBlob(item.pdf), item.title)}><Download className="mr-1 h-4 w-4" />PDF</Button>{!archive && <Button size="sm" variant="outline" onClick={() => void saveGoogleRow(item)}><Table2 className="mr-1 h-4 w-4" />Google Sheets</Button>}<Button size="sm" variant={archive ? 'outline' : 'secondary'} onClick={() => setProtocols(current => current.map(value => value.id === item.id ? { ...value, archived: !archive } : value))}>{archive ? 'Вернуть' : 'В архив'}</Button></div></div></article>)}</div>;
  return <main className="min-h-screen bg-muted/30"><div className="mx-auto flex min-h-screen max-w-6xl"><aside className="w-56 shrink-0 border-r bg-card p-4"><div className="mb-6 flex items-center gap-2 font-semibold"><FileText className="h-5 w-5 text-primary" />Протоколы</div><nav className="space-y-1">{nav('create', 'Создать протокол', FileText)}{nav('settings', 'Настройки', Settings)}{nav('notifications', 'Уведомления', Bell)}</nav></aside><section className="min-w-0 flex-1 p-5 sm:p-8">{section === 'create' && <form onSubmit={makePdf} className="mx-auto max-w-3xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Создать протокол</h1><p className="mt-1 text-muted-foreground">Сохранённый PDF автоматически появится в уведомлениях.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium">Тип совета</label><select value={council} onChange={event => setCouncil(event.target.value as Council)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="elders">Пресвитерский совет</option><option value="church">Церковный совет</option></select></div><div className="space-y-2"><label className="text-sm font-medium">Дата</label><Input type="date" value={date} onChange={event => setDate(event.target.value)} required /></div></div><div className="space-y-2"><label className="text-sm font-medium">Место</label><Input value={place} onChange={event => setPlace(event.target.value)} /></div><div className="space-y-2"><label className="text-sm font-medium">Присутствовали</label><Button type="button" variant="outline" onClick={() => setPickerOpen(value => !value)}><Users className="mr-2 h-4 w-4" />Добавить присутствующих</Button>{pickerOpen && <div className="space-y-2 rounded-lg border p-3">{settings.people.length === 0 ? <p className="text-sm text-muted-foreground">Добавьте людей в «Настройки».</p> : settings.people.map(person => <label key={person} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={present.includes(person)} onChange={() => togglePerson(person)} />{person}</label>)}</div>}{present.length > 0 && <p className="text-sm text-muted-foreground">Выбрано: {present.join(', ')}</p>}</div><div className="space-y-2"><label className="text-sm font-medium">Текст протокола / решения</label><Textarea value={content} onChange={event => setContent(event.target.value)} rows={10} required /></div><Button type="submit" className="gap-2" disabled={saving || !present.length}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Сохранить PDF</Button></form>}{section === 'settings' && <div className="mx-auto max-w-3xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Настройки</h1><p className="mt-1 text-muted-foreground">Список участников доступен при создании каждого протокола.</p></div><div className="space-y-2"><label className="text-sm font-medium">Участники совета</label><div className="flex gap-2"><Input value={newPerson} onChange={event => setNewPerson(event.target.value)} placeholder="Имя и фамилия" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addPerson(); } }} /><Button type="button" onClick={addPerson}><Plus className="mr-1 h-4 w-4" />Добавить</Button></div><div className="flex flex-wrap gap-2">{settings.people.map(person => <span key={person} className="rounded-full border px-3 py-1 text-sm">{person}<button className="ml-2 text-destructive" onClick={() => setSettings(current => ({ ...current, people: current.people.filter(value => value !== person) }))}>×</button></span>)}</div></div><div className="space-y-2"><label className="text-sm font-medium">Google Таблица</label><Input value={settings.googleSheetUrl} onChange={event => setSettings(current => ({ ...current, googleSheetUrl: event.target.value }))} placeholder="Ссылка на Google Sheets" /><p className="text-xs text-muted-foreground">В уведомлениях кнопка Google Sheets скопирует строку протокола и откроет указанную таблицу для вставки.</p></div><div className="space-y-2"><label className="text-sm font-medium">Облако для ZIP-архива</label><Input value={settings.cloudName} onChange={event => setSettings(current => ({ ...current, cloudName: event.target.value }))} placeholder="Например: Google Drive / WebDAV" /><p className="text-xs text-muted-foreground">Архив создаётся кнопкой ZIP в разделе «Архив» и готов к загрузке в выбранное облако.</p></div></div>}{section === 'notifications' && <div className="mx-auto max-w-3xl space-y-5"><div><h1 className="text-2xl font-bold">Уведомления</h1><p className="mt-1 text-muted-foreground">Все созданные PDF-протоколы и архив документов.</p></div><div className="flex gap-2"><Button variant={notificationTab === 'main' ? 'default' : 'outline'} onClick={() => setNotificationTab('main')}>Основной</Button><Button variant={notificationTab === 'archive' ? 'default' : 'outline'} onClick={() => setNotificationTab('archive')}>Архив</Button>{notificationTab === 'archive' && archivedProtocols.length > 0 && <Button className="ml-auto" onClick={() => void makeArchive()}><Archive className="mr-2 h-4 w-4" />Скачать ZIP</Button>}</div>{notificationTab === 'main' ? protocolList(activeProtocols, false) : protocolList(archivedProtocols, true)}</div>}</section></div></main>;
};

export default PublicProtocols;
