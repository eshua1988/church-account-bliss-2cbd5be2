import { useEffect, useMemo, useState } from 'react';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { FileDown, MessageSquare, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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

type ExpenseOrderDraft = {
  date: string;
  amount: number;
  currency: string;
  department: string;
  account: string;
  basis: string;
  pdfBase64: string;
};

type Props = {
  protocols: Protocol[];
  churchName: string;
  secretaryName: string;
  secretarySignature: string;
  onSave: (protocol: Protocol, content: string, validity: string, pdfBase64: string, createExpenseOrder?: boolean, expenseOrder?: ExpenseOrderDraft) => Promise<void>;
  editingExcerpt?: Protocol | null;
};

const formatDate = (date: string, time?: string) =>
  `${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`))} г.${time ? ` ${time}` : ''}`;

const todayIso = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

const base64ToBytes = (value: string) => Uint8Array.from(atob(value.replace(/^data:application\/pdf;base64,/, '')), character => character.charCodeAt(0));

// The public payout form uses this wording in its printed receipt. Keeping it
// here means the order created from a protocol has the same printable fields.
const payoutAmountInWords = (amount: number, currency: string) => {
  const ones = ['', 'jeden', 'dwa', 'trzy', 'cztery', 'pięć', 'sześć', 'siedem', 'osiem', 'dziewięć', 'dziesięć', 'jedenaście', 'dwanaście', 'trzynaście', 'czternaście', 'piętnaście', 'szesnaście', 'siedemnaście', 'osiemnaście', 'dziewiętnaście'];
  const tens = ['', '', 'dwadzieścia', 'trzydzieści', 'czterdzieści', 'pięćdziesiąt', 'sześćdziesiąt', 'siedemdziesiąt', 'osiemdziesiąt', 'dziewięćdziesiąt'];
  const hundreds = ['', 'sto', 'dwieście', 'trzysta', 'czterysta', 'pięćset', 'sześćset', 'siedemset', 'osiemset', 'dziewięćset'];
  const spellHundreds = (value: number): string => {
    if (value < 20) return ones[value];
    if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ''}`;
    return `${hundreds[Math.floor(value / 100)]}${value % 100 ? ` ${spellHundreds(value % 100)}` : ''}`;
  };
  const whole = Math.floor(amount);
  const groupWord = (value: number, forms: [string, string, string]) => {
    const lastTwo = value % 100;
    if (lastTwo >= 11 && lastTwo <= 19) return forms[2];
    if (value % 10 === 1) return forms[0];
    if (value % 10 >= 2 && value % 10 <= 4) return forms[1];
    return forms[2];
  };
  const groups: Array<[number, [string, string, string] | null]> = [
    [Math.floor(whole / 1_000_000_000), ['miliard', 'miliardy', 'miliardów']],
    [Math.floor(whole / 1_000_000) % 1000, ['milion', 'miliony', 'milionów']],
    [Math.floor(whole / 1000) % 1000, ['tysiąc', 'tysiące', 'tysięcy']],
    [whole % 1000, null],
  ];
  const currencyWord = currency === 'PLN' ? (whole % 100 >= 11 && whole % 100 <= 19 ? 'złotych' : whole % 10 === 1 ? 'złoty' : whole % 10 >= 2 && whole % 10 <= 4 ? 'złote' : 'złotych') : currency;
  const valueParts = groups.flatMap(([group, forms]) => {
    if (!group) return [];
    return forms ? [`${spellHundreds(group)} ${groupWord(group, forms)}`] : [spellHundreds(group)];
  });
  const value = `${valueParts.length ? valueParts.join(' ') : 'zero'} ${currencyWord}`.trim();
  const cents = Math.round((amount - whole) * 100);
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}${cents ? ` ${cents}/100` : ''}`;
};

const numberedLines = (content: string) => content.split(/\r?\n/).map(value => value.trim()).filter(value => /^\d+(?:\.\d+)*\.\s+/.test(value));

const expenseDepartments = [
  'Админ-хозяйственный отдел',
  'Благотворительный отдел',
  'Детский отдел',
  'Диаконский отдел',
  'Женский отдел',
  'Миссионерский отдел',
  'Молодежный отдел',
  'Пасторский отдел',
  'Подростковый отдел',
  'Медиа отдел',
  'Мужской отдел',
  'Музыкальный отдел',
  'Общецерковный отдел',
  'Прочее (расход)',
  'Решение братского совета',
  'Ученичества отдел',
];

const excerptSelection = (content: string) => {
  const lines: string[] = [];
  const comments: Record<string, string> = {};
  const validities: Record<string, string> = {};
  let currentLine = '';
  for (const rawValue of content.split(/\r?\n/)) {
    const value = rawValue.trim();
    if (!value) continue;
    if (/^\d+(?:\.\d+)*\.\s+/.test(value)) {
      currentLine = value;
      lines.push(value);
      continue;
    }
    if (!currentLine) continue;
    if (/^Срок действия:\s*/i.test(value)) {
      validities[currentLine] = value.replace(/^Срок действия:\s*/i, '');
      continue;
    }
    const comment = value.replace(/^Комментарий:\s*/i, '');
    comments[currentLine] = [comments[currentLine], comment].filter(Boolean).join('\n');
  }
  return { lines, comments, validities };
};

export function ProtocolExcerptGenerator({ protocols, churchName, secretaryName, secretarySignature, onSave, editingExcerpt }: Props) {
  const archived = protocols.filter(protocol => protocol.archived);
  const [protocolId, setProtocolId] = useState('');
  const [selectedLines, setSelectedLines] = useState<string[]>([]);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [validities, setValidities] = useState<Record<string, string>>({});
  const [commentEditorLine, setCommentEditorLine] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [expenseDraftOpen, setExpenseDraftOpen] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCurrency, setExpenseCurrency] = useState('PLN');
  const [expenseDepartment, setExpenseDepartment] = useState('');
  const [expenseAccount, setExpenseAccount] = useState('');
  const [expenseDate, setExpenseDate] = useState(todayIso);
  const [excerptPdfBase64, setExcerptPdfBase64] = useState('');
  const candidates = editingExcerpt && !archived.some(item => item.id === editingExcerpt.id) ? [editingExcerpt, ...archived] : archived;
  const protocol = candidates.find(item => item.id === protocolId);
  const lines = useMemo(() => protocol ? numberedLines(protocol.content) : [], [protocol]);

  useEffect(() => {
    if (!editingExcerpt) return;
    setProtocolId(editingExcerpt.id);
    const selection = excerptSelection(editingExcerpt.content);
    setSelectedLines(selection.lines);
    setComments(selection.comments);
    setValidities(selection.validities);
    const storedValidity = editingExcerpt.pastor_name?.split('|')[1];
    if (storedValidity === 'До следующего решения' || storedValidity === 'Одноразовая') {
      setValidities(current => Object.fromEntries(selection.lines.map(line => [line, current[line] || storedValidity])));
    }
  }, [editingExcerpt]);

  const chooseProtocol = (id: string) => {
    setProtocolId(id);
    setSelectedLines([]);
    setComments({});
    setValidities({});
    setCommentEditorLine(null);
  };

  const toggleLine = (line: string) => setSelectedLines(current => {
    if (!current.includes(line)) return [...current, line];
    setComments(previous => {
      const next = { ...previous };
      delete next[line];
      return next;
    });
    setValidities(previous => {
      const next = { ...previous };
      delete next[line];
      return next;
    });
    setCommentEditorLine(currentEditor => currentEditor === line ? null : currentEditor);
    return current.filter(item => item !== line);
  });

  const validityFor = (line: string) => validities[line] || 'До следующего решения';
  const excerptContent = selectedLines.map(line => {
    const comment = comments[line]?.trim();
    return [line, comment ? `Комментарий: ${comment}` : '', `Срок действия: ${validityFor(line)}`].filter(Boolean).join('\n');
  }).join('\n');

  const savePdf = async (createExpenseOrder = false) => {
    if (!protocol || selectedLines.length === 0) return;
    setSaving(true);
    try {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), character => character.charCodeAt(0)));
      const width = 595.28, height = 841.89, margin = 58;
      const page = pdf.addPage([width, height]);
      let y = height - 58;
      const write = (value: string, size = 11, gap = 6, options: { x?: number; color?: ReturnType<typeof rgb> } = {}) => {
        let row = '';
        for (const word of value.trim().split(/\s+/)) {
          const candidate = row ? `${row} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) > width - margin * 2 && row) {
            page.drawText(row, { x: options.x ?? margin, y, size, font, color: options.color ?? rgb(0, 0, 0) });
            y -= size + gap;
            row = word;
          } else row = candidate;
        }
        if (row) {
          page.drawText(row, { x: options.x ?? margin, y, size, font, color: options.color ?? rgb(0, 0, 0) });
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
      selectedLines.forEach(line => {
        write(line, 11, 8);
        const comment = comments[line]?.trim();
        if (comment) {
          write(`(${comment})`, 9, 5, { x: margin + 14, color: rgb(.35, .35, .35) });
          y -= 5;
        }
        write(`Срок действия: ${validityFor(line)}`, 9, 5, { x: margin + 14, color: rgb(.35, .35, .35) });
        y -= 8;
      });
      const signatureY = 105;
      if (secretarySignature) {
        const image = await pdf.embedPng(secretarySignature);
        const scale = Math.min(145 / image.width, 52 / image.height);
        page.drawImage(image, { x: margin, y: signatureY - 52, width: image.width * scale, height: image.height * scale });
      }
      page.drawText('Выписку составил, секретарь', { x: margin, y: signatureY + 20, size: 9, font });
      page.drawText(secretaryName || '____________________', { x: margin, y: signatureY, size: 11, font });
      const bytes = await pdf.save();
      const pdfBase64 = bytesToBase64(bytes);
      const distinctValidities = [...new Set(selectedLines.map(validityFor))];
      if (createExpenseOrder) {
        setExcerptPdfBase64(pdfBase64);
        setExpenseDate(todayIso());
        setExpenseDraftOpen(true);
      } else {
        await onSave(protocol, excerptContent, distinctValidities.length === 1 ? distinctValidities[0] : 'Несколько сроков', pdfBase64);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveExpenseOrder = async () => {
    if (!protocol || !excerptPdfBase64 || !expenseDepartment || !(Number(expenseAmount) > 0)) return;
    setSaving(true);
    try {
      const pdf = await PDFDocument.create();
      pdf.registerFontkit(fontkit);
      const font = await pdf.embedFont(Uint8Array.from(atob(ROBOTO_FONT_BASE64), character => character.charCodeAt(0)));
      // Match the public payout link: the first page is a Polish payout receipt
      // with bordered fields and signature areas, followed by the excerpt PDF.
      const width = 595.28, height = 841.89, margin = 58;
      const page = pdf.addPage([width, height]);
      const tableWidth = width - margin * 2;
      const labelWidth = 142;
      const valueWidth = tableWidth - labelWidth;
      const rowHeight = 28;
      const padding = 8;
      const amount = Number(expenseAmount);
      const wrap = (value: string, maxWidth: number, size = 10) => {
        const words = value.trim().split(/\s+/).filter(Boolean);
        const result: string[] = [];
        let line = '';
        words.forEach(word => {
          const next = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(next, size) > maxWidth && line) { result.push(line); line = word; } else line = next;
        });
        if (line) result.push(line);
        return result;
      };
      const writeWrapped = (value: string, x: number, top: number, maxWidth: number, size = 10) => {
        const result = wrap(value, maxWidth, size);
        result.forEach((lineValue, index) => page.drawText(lineValue, { x, y: top - index * (size + 3), size, font }));
        return result.length;
      };
      const cell = (x: number, top: number, cellWidth: number, cellHeight: number, value: string, shaded = false, size = 10) => {
        if (shaded) page.drawRectangle({ x, y: top - cellHeight, width: cellWidth, height: cellHeight, color: rgb(.94, .94, .94) });
        page.drawRectangle({ x, y: top - cellHeight, width: cellWidth, height: cellHeight, borderColor: rgb(0, 0, 0), borderWidth: .45 });
        writeWrapped(value, x + padding, top - cellHeight / 2 + size / 2 - 1, cellWidth - padding * 2, size);
      };
      const tableRow = (top: number, label: string, value: string, cellHeight = rowHeight) => {
        cell(margin, top, labelWidth, cellHeight, label, true);
        cell(margin + labelWidth, top, valueWidth, cellHeight, value);
      };
      const heading = churchName || 'KOŚCIÓŁ BIBLIJNYCH CHRZEŚCIJAN W WARSZAWIE';
      page.drawText(heading, { x: (width - font.widthOfTextAtSize(heading, 11)) / 2, y: height - 55, size: 11, font });
      const title = 'Dowód wypłaty';
      page.drawText(title, { x: (width - font.widthOfTextAtSize(title, 16)) / 2, y: height - 92, size: 16, font });
      let top = height - 130;
      const halfTable = (tableWidth - 12) / 2;
      const dateValueWidth = halfTable - 62;
      cell(margin, top, 62, rowHeight, 'Data', true);
      cell(margin + 62, top, dateValueWidth, rowHeight, expenseDate);
      const amountX = margin + halfTable + 12;
      cell(amountX, top, 85, rowHeight, `Kwota (${expenseCurrency})`, true);
      cell(amountX + 85, top, halfTable - 85, rowHeight, `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expenseCurrency}`);
      top -= rowHeight + 18;
      tableRow(top, 'Wydano (imię i nazwisko)', secretaryName || '____________________');
      top -= rowHeight;
      tableRow(top, 'Konto do przelewu', expenseAccount.trim() || '—');
      top -= rowHeight;
      tableRow(top, 'Nazwa działu', expenseDepartment);
      top -= rowHeight;
      const basisRows = Math.max(2, wrap(excerptContent, valueWidth - padding * 2).length);
      const basisHeight = Math.max(58, basisRows * 14 + padding * 2);
      tableRow(top, 'Na podstawie', excerptContent, basisHeight);
      top -= basisHeight;
      const amountWords = payoutAmountInWords(amount, expenseCurrency);
      const wordsHeight = 58;
      tableRow(top, 'Kwota słownie', amountWords, wordsHeight);
      top -= wordsHeight + 34;
      const signatureHeight = 72;
      const divider = margin + Math.round(tableWidth * .58);
      page.drawRectangle({ x: margin, y: top - signatureHeight, width: tableWidth, height: signatureHeight, borderColor: rgb(0, 0, 0), borderWidth: .55 });
      page.drawLine({ start: { x: divider, y: top }, end: { x: divider, y: top - signatureHeight }, thickness: .55, color: rgb(0, 0, 0) });
      page.drawText('Podpis odbiorcy:', { x: margin + padding, y: top - 18, size: 10, font });
      if (secretarySignature) {
        const image = await pdf.embedPng(secretarySignature);
        const scale = Math.min((tableWidth - (divider - margin) - 20) / image.width, 48 / image.height);
        page.drawImage(image, { x: divider + 10, y: top - 58, width: image.width * scale, height: image.height * scale });
      }
      top -= signatureHeight + 16;
      const cashierHeight = 70;
      page.drawRectangle({ x: margin, y: top - cashierHeight, width: tableWidth, height: cashierHeight, borderColor: rgb(0, 0, 0), borderWidth: .45 });
      page.drawLine({ start: { x: divider, y: top }, end: { x: divider, y: top - cashierHeight }, thickness: .45, color: rgb(0, 0, 0) });
      page.drawText('Kasjer:', { x: margin + padding, y: top - 18, size: 10, font });
      page.drawText('Podpis kasjera:', { x: divider + padding, y: top - 18, size: 10, font });
      const excerptPdf = await PDFDocument.load(base64ToBytes(excerptPdfBase64));
      const excerptPages = await pdf.copyPages(excerptPdf, excerptPdf.getPageIndices());
      excerptPages.forEach(item => pdf.addPage(item));
      const pdfBase64 = bytesToBase64(await pdf.save());
      await onSave(protocol, excerptContent, 'Расходный ордер', '', false, {
        date: expenseDate,
        amount: Number(expenseAmount),
        currency: expenseCurrency,
        department: expenseDepartment,
        account: expenseAccount.trim(),
        basis: excerptContent,
        pdfBase64,
      });
      setExpenseDraftOpen(false);
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
      {lines.length ? lines.map(line => {
        const selected = selectedLines.includes(line);
        const editorOpen = commentEditorLine === line;
        return <div key={line} className="rounded-md p-2 hover:bg-muted/50">
          <div className="flex items-start gap-3">
            <input type="checkbox" checked={selected} onChange={() => toggleLine(line)} className="mt-1 h-4 w-4"/>
            <span className="flex-1 text-sm">{line}</span>
            {selected && <Button type="button" variant={editorOpen || comments[line] ? 'secondary' : 'outline'} size="sm" className="shrink-0" onClick={() => setCommentEditorLine(current => current === line ? null : line)}><MessageSquare className="mr-1 h-4 w-4"/>Комментарий</Button>}
          </div>
          {selected && <label className="ml-7 mt-3 block max-w-sm space-y-1 text-xs font-medium text-muted-foreground">Срок действия этого пункта
            <select value={validityFor(line)} onChange={event => setValidities(current => ({ ...current, [line]: event.target.value }))} className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"><option>До следующего решения</option><option>Одноразовая</option></select>
          </label>}
          {selected && editorOpen && <div className="ml-7 mt-3 space-y-2"><label className="text-xs font-medium text-muted-foreground">Комментарий будет размещён под этим пунктом в выписке PDF</label><textarea value={comments[line] || ''} onChange={event => setComments(current => ({ ...current, [line]: event.target.value }))} rows={3} placeholder="Введите комментарий" className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"/></div>}
        </div>;
      }) : <p className="text-sm text-muted-foreground">В этом протоколе не найдены нумерованные пункты вида «1.», «1.1» или «1.1.1».</p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" disabled={!protocol || selectedLines.length === 0 || saving} onClick={() => void savePdf()}>{saving ? 'Создание PDF…' : <><FileDown className="mr-2 h-4 w-4"/>Сохранить PDF</>}</Button>
      <Button type="button" variant="outline" disabled={!protocol || selectedLines.length === 0 || saving} onClick={() => void savePdf(true)}><ReceiptText className="mr-2 h-4 w-4"/>Добавить в расходный ордер</Button>
    </div>
    {expenseDraftOpen && protocol && <div className="space-y-5 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-6">
      <div><h2 className="text-xl font-bold">Дополнительные данные расходного ордера</h2><p className="mt-1 text-sm text-muted-foreground">Данные остаются в разделе протоколов и переносятся в бланк расходного ордера. Выписка будет вложена второй страницей PDF.</p></div>
      <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-sm font-medium">Дата<Input type="date" value={expenseDate} readOnly/></label><label className="space-y-2 text-sm font-medium">Сумма *<Input type="number" min="0" step="0.01" value={expenseAmount} onChange={event => setExpenseAmount(event.target.value)} placeholder="0,00"/></label><label className="space-y-2 text-sm font-medium">Валюта<select value={expenseCurrency} onChange={event => setExpenseCurrency(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option>PLN</option><option>EUR</option><option>USD</option><option>UAH</option></select></label><label className="space-y-2 text-sm font-medium sm:col-span-2">Выдано (имя и фамилия)<Input value={secretaryName} readOnly aria-readonly="true"/></label><label className="space-y-2 text-sm font-medium">Счёт для перевода<Input value={expenseAccount} onChange={event => setExpenseAccount(event.target.value)} placeholder="Если нужен"/></label></div>
      <div className="space-y-3 rounded-lg border bg-card p-4"><p className="font-medium">Дополнительные сведения</p><label className="block space-y-2 text-sm font-medium">Отдел *<select value={expenseDepartment} onChange={event => setExpenseDepartment(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="" disabled>Выберите отдел</option>{expenseDepartments.map(department => <option key={department} value={department}>{department}</option>)}</select></label><label className="block space-y-2 text-sm font-medium">Основание<Textarea value={excerptContent} readOnly rows={5}/></label></div>
      <p className="text-xs text-muted-foreground">В итоговом PDF первая страница — расходный ордер, вторая — выписка из протокола. Подпись секретаря и выписка прикладываются автоматически.</p>
      <Button type="button" disabled={saving || !expenseDepartment || !(Number(expenseAmount) > 0)} onClick={() => void saveExpenseOrder()}>{saving ? 'Сохранение…' : <><FileDown className="mr-2 h-4 w-4"/>Сохранить расходный ордер</>}</Button>
    </div>}
  </section>;
}
