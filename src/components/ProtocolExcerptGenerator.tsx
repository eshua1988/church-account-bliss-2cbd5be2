import { useEffect, useMemo, useState } from 'react';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { CheckSquare, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ROBOTO_FONT_BASE64 } from '@/lib/robotoFont';

type Protocol = {
  id: string;
  council: string;
  protocol_date: string;
  protocol_time: string;
  place: string;
  present: string[];
  absent: string[];
  content: string;
  archived: boolean;
  pastor_name?: string;
};

type Props = {
  protocols: Protocol[];
  churchName: string;
  secretaryName: string;
  secretarySignature: string;
  onSave: (protocol: Protocol, content: string, validity: string, pdfBase64: string) => Promise<void>;
  editingExcerpt?: Protocol | null;
};

const formatDate = (date: string, time?: string) =>
  `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))} г.${time ? ` ${time}` : ''}`;

const numberedLines = (content: string) => content.split(/\r?\n/).map(value => value.trim()).filter(value => /^\d+(?:\.\d+)*\.\s+/.test(value));

export function ProtocolExcerptGenerator({ protocols, churchName, secretaryName, secretarySignature, onSave, editingExcerpt }: Props) {
  const archived = protocols.filter(protocol => protocol.archived);
  const [protocolId, setProtocolId] = useState('');
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [validity, setValidity] = useState('До следующего решения');
  const [saving, setSaving] = useState(false);
  const candidates = editingExcerpt && !archived.some(item => item.id === editingExcerpt.id) ? [editingExcerpt, ...archived] : archived;
  const protocol = candidates.find(item => item.id === protocolId);
  const lines = useMemo(() => protocol ? numberedLines(protocol.content) : [], [protocol]);

  useEffect(() => {
    if (!editingExcerpt) return;
    setProtocolId(editingExcerpt.id);
    setSelectedLines(numberedLines(editingExcerpt.content));
    const storedValidity = editingExcerpt.pastor_name?.split('|')[1];
    if (storedValidity === 'До следующего решения' || storedValidity === 'Одноразовая') setValidity(storedValidity);
  }, [editingExcerpt]);

  const chooseProtocol = (id: string) => {
    setProtocolId(id);
    setSelectedLines([]);
  };

  const toggleLine = (line: string) => setSelectedLines(current => current.includes(line) ? current.filter(item => item !== line) : [...current, line]);

  const savePdf = async () => {
    if (!protocol || selectedLines.length === 0) return;
    setSaving(true);
    try {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), character => character.charCodeAt(0)));
      const width = 595.28, height = 841.89, margin = 58;
      const page = pdf.addPage([width, height]);
      let y = height - 58;
      const write = (value: string, size = 11, gap = 6) => {
        let row = '';
        for (const word of value.trim().split(/\s+/)) {
          const candidate = row ? `${row} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) > width - margin * 2 && row) {
            page.drawText(row, { x: margin, y, size, font, color: rgb(0, 0, 0) });
            y -= size + gap;
            row = word;
          } else row = candidate;
        }
        if (row) {
          page.drawText(row, { x: margin, y, size, font, color: rgb(0, 0, 0) });
          y -= size + gap;
        }
      };
      if (churchName) {
        page.drawRectangle({ x: 0, y: height - 92, width, height: 92, color: rgb(.14, .13, .13) });
        const size = 20;
        page.drawText(churchName, { x: Math.max(20, (width - font.widthOfTextAtSize(churchName, size)) / 2), y: height - 54, size, font, color: rgb(1, 1, 1) });
        y = height - 122;
      }
      write(formatDate(protocol.protocol_date, protocol.protocol_time), 10, 28);
      const title = 'Выписка из протокола';
      page.drawText(title, { x: (width - font.widthOfTextAtSize(title, 16)) / 2, y, size: 16, font });
      y -= 40;
      write(`Место: ${protocol.place || '-'}`);
      write(`Присутствовали: ${protocol.present.join(', ') || '-'}`);
      write(`Отсутствовали: ${protocol.absent.join(', ') || '-'}`);
      y -= 20;
      page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .8, color: rgb(.45, .45, .45) });
      y -= 32;
      selectedLines.forEach(line => { write(line, 11, 8); y -= 8; });
      y -= 12;
      write(`Срок действия: ${validity}`, 10, 8);
      const signatureY = 105;
      if (secretarySignature) {
        const image = await pdf.embedPng(secretarySignature);
        const scale = Math.min(145 / image.width, 52 / image.height);
        page.drawImage(image, { x: margin, y: signatureY - 52, width: image.width * scale, height: image.height * scale });
      }
      page.drawText('Выписку составил, секретарь', { x: margin, y: signatureY + 20, size: 9, font });
      page.drawText(secretaryName || '____________________', { x: margin, y: signatureY, size: 11, font });
      const bytes = await pdf.save();
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      await onSave(protocol, selectedLines.join('\n'), validity, btoa(binary));
    } finally {
      setSaving(false);
    }
  };

  return <section className="w-full max-w-6xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8">
    <div><h1 className="text-2xl font-bold">Выписка из протокола</h1><p className="mt-1 text-muted-foreground">Выберите архивный протокол и пункты решения, которые должны войти в выписку.</p></div>
    <label className="block space-y-2 text-sm font-medium">Протокол из архива
      <select value={protocolId} onChange={event => chooseProtocol(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
        <option value="">Выберите протокол</option>
        {candidates.map(item => <option key={item.id} value={item.id}>{formatDate(item.protocol_date, item.protocol_time)} — {item.place || 'место не указано'}</option>)}
      </select>
    </label>
    {protocolId && <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">Пункты протокола</p>
      {lines.length ? lines.map(line => <label key={line} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50"><input type="checkbox" checked={selectedLines.includes(line)} onChange={() => toggleLine(line)} className="mt-1 h-4 w-4"/><span className="text-sm">{line}</span></label>) : <p className="text-sm text-muted-foreground">В этом протоколе не найдены нумерованные пункты вида «1.», «1.1» или «1.1.1».</p>}
    </div>}
    <label className="block space-y-2 text-sm font-medium">Срок действия
      <select value={validity} onChange={event => setValidity(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option>До следующего решения</option><option>Одноразовая</option></select>
    </label>
    <Button type="button" disabled={!protocol || selectedLines.length === 0 || saving} onClick={() => void savePdf()}>{saving ? 'Создание PDF…' : <><FileDown className="mr-2 h-4 w-4"/>Сохранить PDF</>}</Button>
  </section>;
}
