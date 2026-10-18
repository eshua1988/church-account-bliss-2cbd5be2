import { FormEvent, useEffect, useState } from 'react';
import fontkit from '@pdf-lib/fontkit';
import { FileDown, FileText, Loader2 } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ROBOTO_FONT_BASE64 } from '@/lib/robotoFont';

const today = () => new Date().toISOString().slice(0, 10);
const councilNames = { elders: 'Пресвитерского совета', church: 'Церковного совета' } as const;
type Council = keyof typeof councilNames;

const PublicProtocols = () => {
  const { token = '' } = useParams();
  const [valid, setValid] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [council, setCouncil] = useState<Council>('church');
  const [date, setDate] = useState(today());
  const [place, setPlace] = useState('');
  const [present, setPresent] = useState('');
  const [absent, setAbsent] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    supabase.from('shared_transaction_links').select('id, name').eq('token', token).eq('is_active', true).maybeSingle()
      .then(({ data }) => setValid(Boolean(data?.name?.startsWith('[Протоколы]'))));
  }, [token]);

  const createPdf = async (event: FormEvent) => {
    event.preventDefault();
    if (!present.trim() || !content.trim()) return;
    setSaving(true);
    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), char => char.charCodeAt(0)));
      const bold = font;
      const margin = 52;
      let page = pdf.addPage([595.28, 841.89]);
      let y = 790;
      const newPage = () => { page = pdf.addPage([595.28, 841.89]); y = 790; };
      const write = (text: string, size = 11, gap = 6) => {
        const words = text.trim().split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
          const candidate = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) > 595.28 - margin * 2 && line) {
            if (y < 70) newPage();
            page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) }); y -= size + gap; line = word;
          } else line = candidate;
        }
        if (line) { if (y < 70) newPage(); page.drawText(line, { x: margin, y, size, font, color: rgb(0, 0, 0) }); y -= size + gap; }
      };
      const heading = (text: string, size: number) => { const width = bold.widthOfTextAtSize(text, size); page.drawText(text, { x: (595.28 - width) / 2, y, size, font: bold }); y -= size + 20; };
      heading('ПРОТОКОЛ', 18);
      heading(councilNames[council].toUpperCase(), 14);
      write(`Дата: ${new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU')}`); write(`Место: ${place.trim() || 'Не указано'}`); write(`Присутствовали: ${present.trim()}`);
      if (absent.trim()) write(`Отсутствовали: ${absent.trim()}`);
      y -= 12; page.drawLine({ start: { x: margin, y }, end: { x: 595.28 - margin, y }, thickness: 1, color: rgb(0.45, 0.45, 0.45) }); y -= 26;
      content.split(/\n+/).forEach(paragraph => { write(paragraph, 12, 8); y -= 8; });
      if (y < 105) newPage(); y -= 30; write(`Секретарь ${councilNames[council]}: ____________________`, 11);
      const bytes = await pdf.save();
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Протокол_${council === 'elders' ? 'Пресвитерского' : 'Церковного'}_совета_${date}.pdf`; anchor.click(); URL.revokeObjectURL(url);
    } finally { setSaving(false); }
  };

  if (valid === null) return <main className="grid min-h-screen place-items-center">Загрузка…</main>;
  if (!valid) return <main className="grid min-h-screen place-items-center text-destructive">Ссылка не найдена или отключена.</main>;
  return <main className="min-h-screen bg-muted/30 p-4 sm:p-8"><form onSubmit={createPdf} className="mx-auto max-w-3xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><FileText className="h-6 w-6 text-primary" />Создать протокол</h1><p className="mt-1 text-muted-foreground">Заполните данные совета и сохраните готовый документ в PDF.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><label className="text-sm font-medium">Тип совета</label><select value={council} onChange={event => setCouncil(event.target.value as Council)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="elders">Пресвитерский совет</option><option value="church">Церковный совет</option></select></div><div className="space-y-2"><label className="text-sm font-medium">Дата</label><Input type="date" value={date} onChange={event => setDate(event.target.value)} required /></div></div><div className="space-y-2"><label className="text-sm font-medium">Место</label><Input value={place} onChange={event => setPlace(event.target.value)} placeholder="Например: Lemiesz 4D" /></div><div className="space-y-2"><label className="text-sm font-medium">Присутствовали</label><Textarea value={present} onChange={event => setPresent(event.target.value)} placeholder="Введите имена и фамилии через запятую" rows={3} required /></div><div className="space-y-2"><label className="text-sm font-medium">Отсутствовали</label><Textarea value={absent} onChange={event => setAbsent(event.target.value)} placeholder="Необязательно" rows={2} /></div><div className="space-y-2"><label className="text-sm font-medium">Текст протокола / решения</label><Textarea value={content} onChange={event => setContent(event.target.value)} placeholder="Введите текст принятых решений. Каждый новый абзац будет сохранён в документе." rows={10} required /></div><Button type="submit" className="gap-2" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}Сохранить PDF</Button></form></main>;
};

export default PublicProtocols;
