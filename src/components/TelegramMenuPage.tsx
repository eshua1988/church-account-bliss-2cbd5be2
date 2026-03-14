import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Bot,
  Save,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Send,
  Copy,
  Link2,
  Hash,
  RefreshCw,
  Smartphone,
  MessageSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  ClipboardCopy,
  ChevronDown,
  ChevronRight,
  FileText,
  Zap,
  Table2,
  Info,
  GripVertical,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code2,
  AtSign,
  Megaphone,
  ExternalLink,
  Palette,
  Rows3,
  CornerDownLeft,
  EyeOff,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ColRowPair { id: string; from: string; to: string; label?: string; }
interface SheetRange {
  id: string;
  sheetName: string;
  cols: ColRowPair[]; // multiple column ranges
  rows: ColRowPair[]; // multiple row ranges
}

interface ExtraButton {
  id: string;
  text: string;
  type: 'url' | 'copy' | 'callback' | 'google_sheet' | 'web_app' | 'switch_inline' | 'switch_inline_current' | 'hashtag';
  value: string;
  enabled: boolean;
  sheetRanges?: SheetRange[]; // structured ranges for google_sheet type
}

interface BotCommand {
  id: string;
  command: string;
  description: string;
}

interface TemplateCopyButton {
  id: string;
  label: string;     // button text
  copyText: string;  // text copied to clipboard
  mode?: 'button' | 'inline'; // button = keyboard below, inline = <code> in text
}

type ButtonBlockType = 'copy' | 'url' | 'mention' | 'hashtag' | 'bot' | 'channel' | 'message';

type TemplateBlock =
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'button'; btnType?: ButtonBlockType; label: string; copyText: string };

interface MessageTemplate {
  id: string;
  title: string;          // admin label
  text: string;           // legacy — kept for compat, not used in new flow
  buttons: TemplateCopyButton[]; // legacy
  blocks: TemplateBlock[]; // new — ordered list of text + button blocks
  trigger: string;        // callback_data that triggers this template
  enabled: boolean;
}

interface MenuOrderItem { id: string; kind: 'button' | 'template'; newRow?: boolean; }

interface LayoutSettings {
  buttonsPerRow: 1 | 2 | 3;
  buttonSize: 'sm' | 'md' | 'lg';
  buttonColor: string;
}

interface MenuConfig {
  welcomeMessage: string;
  extraButtons: ExtraButton[];
  botCommands: BotCommand[];
  messageTemplates: MessageTemplate[];
  menuOrder: MenuOrderItem[];
  layoutSettings: LayoutSettings;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#2b5278', '#1a5276', '#1e8449', '#6c3483',
  '#922b21', '#935116', '#212f3c', '#7d6608',
];

const defaultLayoutSettings: LayoutSettings = { buttonsPerRow: 1, buttonSize: 'md', buttonColor: '#2b5278' };

const defaultConfig: MenuConfig = {
  welcomeMessage: '👋 Выберите действие:',
  extraButtons: [],
  layoutSettings: defaultLayoutSettings,
  botCommands: [
    { id: '1', command: 'start', description: 'Главное меню' },
    { id: '2', command: 'help', description: 'Помощь и инструкция' },
  ],
  messageTemplates: [],
  menuOrder: [],
};

// Build menuOrder from current buttons + templates, preserving existing order
function buildMenuOrder(
  extraButtons: ExtraButton[],
  messageTemplates: MessageTemplate[],
  existing: MenuOrderItem[],
): MenuOrderItem[] {
  const all: MenuOrderItem[] = [
    ...extraButtons.map((b) => ({ id: b.id, kind: 'button' as const })),
    ...messageTemplates.map((t) => ({ id: t.id, kind: 'template' as const })),
  ];
  const allIds = new Set(all.map((x) => x.id));
  // Keep existing order, drop removed items, append new ones at end
  const ordered = existing.filter((x) => allIds.has(x.id));
  const orderedIds = new Set(ordered.map((x) => x.id));
  for (const item of all) {
    if (!orderedIds.has(item.id)) ordered.push(item);
  }
  return ordered;
}

const BUTTON_TYPE_META: Record<ExtraButton['type'], { label: string; placeholder: string; hint: string; color?: string }> = {
  url:                    { label: '🔗 URL-ссылка',            placeholder: 'https://example.com',          hint: 'Открыть ссылку в браузере',                        color: 'blue' },
  copy:                   { label: '⎘ Скопировать текст',      placeholder: 'Текст для копирования',        hint: 'Нажатие копирует текст в буфер обмена',             color: 'purple' },
  callback:               { label: '⚡ Действие бота',          placeholder: 'callback_data',                hint: 'Отправляет callback боту — для обработки логики',   color: 'yellow' },
  google_sheet:           { label: '📈 Google Таблица',         placeholder: 'Лист1!A1:D20',                hint: 'Бот пришлёт данные из Google Sheets',               color: 'green' },
  web_app:                { label: '📱 Mini App (WebApp)',       placeholder: 'https://your-webapp.com',      hint: 'Открыть Telegram Mini App по URL',                  color: 'cyan' },
  switch_inline:          { label: '🔄 Inline → другой чат',    placeholder: 'запрос для inline...',         hint: 'Переключит на inline-режим в выбранном чате',       color: 'orange' },
  switch_inline_current:  { label: '💬 Inline → этот чат',      placeholder: 'запрос для inline...',         hint: 'Переключит на inline-режим в текущем чате',         color: 'orange' },
  hashtag:                { label: '# Хэштег',                 placeholder: '#молитва',                     hint: 'Вставляет хэштег в поле поиска текущего чата',      color: 'pink' },
};

const QUICK_EMOJI = ['👋', '✅', '🔔', '📋', '💰', '📊', '⚙️', '🏠', '📱', '🔍'];

const BUTTON_BLOCK_META: Record<ButtonBlockType, { label: string; badge: string; valuePlaceholder: string; valueLabel: string }> = {
  copy:    { label: '⎘ Копировать',   badge: '⎘ КОПИЯ',  valuePlaceholder: 'Текст для копирования...',  valueLabel: 'КОПИР.' },
  url:     { label: '🔗 URL-ссылка',  badge: '🔗 URL',    valuePlaceholder: 'https://example.com',        valueLabel: 'ССЫЛКА' },
  mention: { label: '@Упоминание',    badge: '@ USER',   valuePlaceholder: '@username',                  valueLabel: '@USER' },
  hashtag: { label: '#Хэштег',        badge: '# ТЭГ',    valuePlaceholder: '#молитва',                   valueLabel: '#ТЭГ' },
  bot:     { label: '🤖 Ссылка на бот', badge: '🤖 БОТ', valuePlaceholder: '@mybot',                     valueLabel: '@БОТ' },
  channel: { label: '📢 Канал',        badge: '📢 КАНАЛ', valuePlaceholder: '@mychannel',                 valueLabel: '@КАНАЛ' },
  message: { label: '💬 Сообщение',   badge: '💬 СООБЩ.', valuePlaceholder: 'https://t.me/c/123/456',   valueLabel: 'ССЫЛКА' },
};

// ─── Telegram interactive layout editor ─────────────────────────────────────

type UnifiedItem =
  | { kind: 'button'; id: string; text: string; btnType: string; idx: number; newRow?: boolean }
  | { kind: 'template'; id: string; text: string; trigger: string; idx: number; newRow?: boolean };

const TelegramLayoutEditor = ({
  config,
  onReorderMenu,
  onChangeLayout,
}: {
  config: MenuConfig;
  onReorderMenu: (fromId: string, toId: string) => void;
  onChangeLayout: (s: LayoutSettings) => void;
}) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const gripDown = useRef(false);
  const touchDragId = useRef<string | null>(null);

  const ls = config.layoutSettings;
  const { buttonsPerRow, buttonSize, buttonColor } = ls;

  const btnMap = new Map(
    config.extraButtons.filter((b) => b.enabled !== false).map((b, i) => [b.id, { ...b, idx: i }])
  );
  const tmplMap = new Map(
    config.messageTemplates.filter((t) => t.enabled).map((t, i) => [t.id, { ...t, idx: i }])
  );

  const order = buildMenuOrder(config.extraButtons, config.messageTemplates, config.menuOrder);
  const items: UnifiedItem[] = order
    .map((o): UnifiedItem | null => {
      if (o.kind === 'button') {
        const b = btnMap.get(o.id);
        return b ? { kind: 'button', id: b.id, text: b.text, btnType: b.type, idx: b.idx, newRow: o.newRow } : null;
      } else {
        const t = tmplMap.get(o.id);
        return t ? { kind: 'template', id: t.id, text: t.title, trigger: t.trigger, idx: t.idx, newRow: o.newRow } : null;
      }
    })
    .filter((x): x is UnifiedItem => x !== null);

  // Group into display rows, respecting per-item newRow flag
  const rowGroups: UnifiedItem[][] = [];
  let currentRow: UnifiedItem[] = [];
  for (const item of items) {
    if (item.newRow && currentRow.length > 0) {
      rowGroups.push(currentRow);
      currentRow = [];
    }
    currentRow.push(item);
    if (currentRow.length >= buttonsPerRow) {
      rowGroups.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) rowGroups.push(currentRow);

  const btnPy = buttonSize === 'sm' ? 'py-1' : buttonSize === 'lg' ? 'py-2.5' : 'py-1.5';

  const typeIcon = (type: string) => {
    if (type === 'url') return <ExternalLink className="w-2.5 h-2.5" />;
    if (type === 'copy') return <Copy className="w-2.5 h-2.5" />;
    if (type === 'google_sheet') return <span className="text-[9px]">📈</span>;
    if (type === 'callback') return <Zap className="w-2.5 h-2.5" />;
    if (type === 'web_app') return <span className="text-[9px]">📱</span>;
    if (type === 'switch_inline') return <RefreshCw className="w-2.5 h-2.5" />;
    if (type === 'switch_inline_current') return <MessageSquare className="w-2.5 h-2.5" />;
    if (type === 'hashtag') return <span className="text-[9px]">#</span>;
    return null;
  };

  return (
    <div className="space-y-3">
      {/* ── Settings panel ── */}
      <div className="rounded-xl border bg-muted/20 px-3 py-2.5 space-y-2.5">
        {/* Telegram limitation notice */}
        <div className="flex items-start gap-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/20 px-2.5 py-1.5">
          <Info className="w-3 h-3 text-yellow-400/80 flex-shrink-0 mt-px" />
          <p className="text-[10px] text-yellow-400/80 leading-relaxed">
            <span className="font-semibold">Только предпросмотр.</span> Цвет и размер кнопок не передаются в Telegram — внешний вид кнопок определяется темой приложения у пользователя. Работает только <span className="font-semibold">«Кнопок в ряд»</span>.
          </p>
        </div>
        {/* Кнопок в ряд */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-32 flex-shrink-0 flex items-center gap-1.5">
            <Rows3 className="w-3 h-3" /> Кнопок в ряд
          </span>
          <div className="flex gap-1">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChangeLayout({ ...ls, buttonsPerRow: n })}
                className={`w-7 h-7 rounded text-xs font-semibold transition-colors ${
                  buttonsPerRow === n
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'bg-muted hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Размер кнопки */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-32 flex-shrink-0">
            Размер кнопки
          </span>
          <div className="flex gap-1">
            {(['sm', 'md', 'lg'] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => onChangeLayout({ ...ls, buttonSize: sz })}
                className={`px-3 h-7 rounded text-xs font-semibold transition-colors ${
                  buttonSize === sz
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'bg-muted hover:bg-muted/60 text-muted-foreground'
                }`}
              >
                {{ sm: 'S', md: 'M', lg: 'L' }[sz]}
              </button>
            ))}
          </div>
        </div>

        {/* Цвет кнопок */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground w-32 flex-shrink-0 flex items-center gap-1.5">
            <Palette className="w-3 h-3" /> Цвет кнопок
          </span>
          <div className="flex gap-1.5 flex-wrap items-center">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => onChangeLayout({ ...ls, buttonColor: c })}
                style={{ background: c }}
                className={`w-6 h-6 rounded-md transition-all ${
                  buttonColor === c
                    ? 'ring-2 ring-offset-1 ring-white scale-110'
                    : 'opacity-70 hover:opacity-100 hover:scale-105'
                }`}
              />
            ))}
            {/* Custom colour picker */}
            <label className="relative w-6 h-6 cursor-pointer" title="Свой цвет">
              <input
                type="color"
                value={buttonColor}
                onChange={(e) => onChangeLayout({ ...ls, buttonColor: e.target.value })}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
              <div
                style={{ background: buttonColor }}
                className="w-6 h-6 rounded-md border-2 border-dashed border-white/50 flex items-center justify-center"
              >
                <Palette className="w-2.5 h-2.5 text-white/70 pointer-events-none" />
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* ── Phone preview ── */}
      <div className="bg-[#17212b] rounded-2xl overflow-hidden shadow-xl border border-white/5">
        {/* Header */}
        <div className="bg-[#242f3d] px-4 pt-3 pb-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-semibold truncate">Мой Telegram Бот</div>
            <div className="flex items-center gap-1 mt-0.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400"></div>
              <span className="text-[10px] text-green-400/90">в сети</span>
            </div>
          </div>
          <span className="text-[9px] text-white/25 uppercase tracking-widest font-semibold">МАКЕТ</span>
        </div>

        {/* Chat area */}
        <div className="px-3 py-4 min-h-[100px]">
          <div className="flex items-start gap-1.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0 flex items-center justify-center mt-0.5">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              {/* Message bubble */}
              <div className="bg-[#232e3c] rounded-2xl rounded-tl-sm px-3 py-2 mb-1">
                <p className="text-white text-[12px] leading-relaxed whitespace-pre-wrap break-words">
                  {config.welcomeMessage || '👋 Выберите действие:'}
                </p>
              </div>

              {/* Keyboard grouped by buttonsPerRow */}
              {rowGroups.length > 0 ? (
                <div className="space-y-0.5">
                  {rowGroups.map((row, rowIdx) => (
                    <div key={rowIdx} className="flex gap-0.5">
                      {row.map((item) => {
                        const isDragOver = dragOverId === item.id;
                        const isDragging = dragId === item.id;
                        return (
                          <div
                            key={item.id}
                            data-item-id={item.id}
                            draggable
                            onDragStart={(e) => {
                              if (!gripDown.current) { e.preventDefault(); return; }
                              gripDown.current = false;
                              setDragId(item.id);
                              dragStartPos.current = { x: e.clientX, y: e.clientY };
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (!dragStartPos.current) return;
                              const dx = Math.abs(e.clientX - dragStartPos.current.x);
                              const dy = Math.abs(e.clientY - dragStartPos.current.y);
                              if (dy > dx && dragId && dragId !== item.id) setDragOverId(item.id);
                            }}
                            onDragLeave={() => setDragOverId(null)}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (dragId && dragId !== item.id) onReorderMenu(dragId, item.id);
                              setDragId(null);
                              setDragOverId(null);
                              dragStartPos.current = null;
                            }}
                            onDragEnd={() => { gripDown.current = false; setDragId(null); setDragOverId(null); dragStartPos.current = null; }}
                            style={{ background: buttonColor }}
                            className={[
                              `group flex flex-1 items-center gap-1 rounded-lg px-1.5 ${btnPy} transition-all duration-150 select-none`,
                              item.kind === 'template' ? 'brightness-90' : '',
                              isDragOver ? 'ring-2 ring-white/50 scale-[1.02]' : '',
                              isDragging ? 'opacity-30 scale-95' : 'opacity-100',
                            ].join(' ')}
                          >
                            <span
                              className="touch-none cursor-grab active:cursor-grabbing flex-shrink-0"
                              onPointerDown={() => { gripDown.current = true; }}
                              onPointerUp={() => { gripDown.current = false; }}
                              onTouchStart={() => { touchDragId.current = item.id; setDragId(item.id); }}
                              onTouchMove={(e) => {
                                const touch = e.touches[0];
                                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                                const itemEl = el?.closest('[data-item-id]');
                                if (itemEl) {
                                  const targetId = itemEl.getAttribute('data-item-id');
                                  if (targetId && targetId !== touchDragId.current) setDragOverId(targetId);
                                }
                              }}
                              onTouchEnd={() => {
                                if (touchDragId.current && dragOverId && touchDragId.current !== dragOverId) {
                                  onReorderMenu(touchDragId.current, dragOverId);
                                }
                                touchDragId.current = null;
                                setDragId(null);
                                setDragOverId(null);
                              }}
                            >
                              <GripVertical className="w-2.5 h-2.5 text-white/30 group-hover:text-white/60 transition-colors" />
                            </span>
                            {item.kind === 'template' && (
                              <FileText className="w-2 h-2 text-white/50 flex-shrink-0" />
                            )}
                            <span className="flex-1 text-[10px] text-white/90 truncate text-center">
                              {item.text}
                            </span>
                            <span className="flex-shrink-0 text-white/40">
                              {item.kind === 'button'
                                ? typeIcon(item.btnType)
                                : <code className="text-[8px] text-white/25 font-mono">/{item.trigger}</code>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-white/20 text-[11px] text-center py-3 border border-white/5 border-dashed rounded-lg">
                  Кнопки не добавлены
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="bg-[#242f3d] px-3 py-2 flex items-center gap-2">
          <div className="flex-1 bg-[#17212b] rounded-xl px-3 py-1.5">
            <span className="text-white/20 text-xs">Написать сообщение...</span>
          </div>
          <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center">
            <Send className="w-3.5 h-3.5 text-blue-400" />
          </div>
        </div>

        {/* Drag hint */}
        {items.length > 1 && (
          <div className="bg-[#17212b] px-3 pb-2 pt-1 text-center">
            <p className="text-[9px] text-white/20 flex items-center justify-center gap-1">
              <GripVertical className="w-2.5 h-2.5" />
              Перетащите кнопку или шаблон для изменения порядка
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

export const TelegramMenuPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [config, setConfig] = useState<MenuConfig>(defaultConfig);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [isDeployingCmds, setIsDeployingCmds] = useState(false);
  const [expandedTemplates, setExpandedTemplates] = useState<Set<string>>(new Set());
  const [expandedButtons, setExpandedButtons] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // templateId → currently selected text in its textarea
  const [textSelections, setTextSelections] = useState<Record<string, string>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [connectedBots, setConnectedBots] = useState<
    Array<{ bot_token: string | null; telegram_chat_id: number; registered_name?: string | null }>
  >([]);
  // Drag-and-drop state for block reordering: "templateId::blockId"
  const dragBlock = useRef<{ templateId: string; blockId: string } | null>(null);
  const dragBlockStartPos = useRef<{ x: number; y: number } | null>(null);
  const blockGripDown = useRef(false);
  const touchBlockDrag = useRef<{ templateId: string; blockId: string } | null>(null);
  const [dragOverBlock, setDragOverBlock] = useState<{ templateId: string; blockId: string } | null>(null);

  // ── Load config ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoading(true);
      try {
        const [cfgRes, botsRes] = await Promise.all([
          supabase
            .from('telegram_bot_config')
            .select('welcome_message, extra_buttons, bot_commands, message_templates, menu_order, button_layout')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('telegram_users')
            .select('bot_token, telegram_chat_id, registered_name')
            .eq('user_id', user.id)
            .eq('is_active', true),
        ]);

        if (cfgRes.data) {
          const d = cfgRes.data as any;
          // Backward compat: migrate old {text, buttons} → blocks
          const rawTemplates: any[] = d.message_templates ?? [];
          const migratedTemplates: MessageTemplate[] = rawTemplates.map((t: any) => {
            if (t.blocks && t.blocks.length > 0) return t as MessageTemplate;
            // old format: build blocks from text + buttons
            const blocks: TemplateBlock[] = [];
            if (t.text) blocks.push({ id: crypto.randomUUID(), type: 'text', content: t.text });
            for (const b of (t.buttons ?? [])) {
              if (b.mode === 'inline') {
                blocks.push({ id: b.id ?? crypto.randomUUID(), type: 'text', content: `${b.label}\n<code>${b.copyText}</code>` });
              } else {
                blocks.push({ id: b.id ?? crypto.randomUUID(), type: 'button', label: b.label, copyText: b.copyText });
              }
            }
            return { ...t, blocks, text: t.text ?? '', buttons: t.buttons ?? [] } as MessageTemplate;
          });
          // Migrate old SheetRange format (colFrom/colTo/rowFrom/rowTo) → new (cols/rows)
          const rawButtons: any[] = d.extra_buttons ?? [];
          const migratedButtons: ExtraButton[] = rawButtons.map((b: any) => {
            // ensure enabled defaults to true for existing buttons
            const withEnabled = { enabled: true, ...b };
            if (!Array.isArray(withEnabled.sheetRanges)) return withEnabled as ExtraButton;
            const ranges: SheetRange[] = b.sheetRanges.map((r: any): SheetRange => {
              if (Array.isArray(r.cols) && Array.isArray(r.rows)) return r as SheetRange;
              // old format
              return {
                id: r.id ?? crypto.randomUUID(),
                sheetName: r.sheetName ?? '',
                cols: [{ id: crypto.randomUUID(), from: r.colFrom ?? 'A', to: r.colTo ?? '' }],
                rows: [{ id: crypto.randomUUID(), from: r.rowFrom ?? '1', to: r.rowTo ?? '50' }],
              };
            });
            return { ...b, sheetRanges: ranges } as ExtraButton;
          });
          const rawMenuOrder: MenuOrderItem[] = d.menu_order ?? [];
          const builtOrder = buildMenuOrder(migratedButtons, migratedTemplates, rawMenuOrder);
          setConfig({
            welcomeMessage: d.welcome_message ?? defaultConfig.welcomeMessage,
            extraButtons: migratedButtons,
            botCommands: (d.bot_commands as BotCommand[]) ?? defaultConfig.botCommands,
            messageTemplates: migratedTemplates,
            menuOrder: builtOrder,
            layoutSettings: { ...defaultLayoutSettings, ...(d.button_layout ?? {}) },
          });
        }
        setConnectedBots((botsRes.data as any) ?? []);
      } catch {
        // ignore load errors
      } finally {
        setIsLoading(false);
      }
    })();
  }, [user]);

  // ── Save ─────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      const { error } = await (supabase as any).from('telegram_bot_config').upsert(
        {
          user_id: user.id,
          welcome_message: config.welcomeMessage,
          extra_buttons: config.extraButtons,
          bot_commands: config.botCommands,
          message_templates: config.messageTemplates,
          menu_order: buildMenuOrder(config.extraButtons, config.messageTemplates, config.menuOrder),
          button_layout: config.layoutSettings,
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;
      toast({ title: '✅ Сохранено', description: 'Настройки меню бота обновлены' });
    } catch (e: any) {
      toast({ title: 'Ошибка сохранения', description: e.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  };

  // ── Send test ─────────────────────────────────────────────────────────────────

  const handleSendTest = async () => {
    if (connectedBots.length === 0) {
      toast({
        title: 'Нет активных ботов',
        description: 'Сначала подключите бота на вкладке «Настройки»',
        variant: 'destructive',
      });
      return;
    }
    setIsSendingTest(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/telegram-bot?send_test=true`, {
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          apikey: anonKey,
        },
      });
      const result = await res.json();
      if (result.ok) {
        toast({
          title: '📨 Тест отправлен',
          description: `Сообщение отправлено в ${result.sent} чат(а/ов)`,
        });
      } else {
        toast({
          title: 'Ошибка',
          description: result.description || 'Неизвестная ошибка',
          variant: 'destructive',
        });
      }
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
    } finally {
      setIsSendingTest(false);
    }
  };

  // ── Deploy bot commands ───────────────────────────────────────────────────────

  const handleDeployCommands = async () => {
    if (connectedBots.length === 0) {
      toast({ title: 'Нет активных ботов', variant: 'destructive' });
      return;
    }
    setIsDeployingCmds(true);
    try {
      const commands = config.botCommands
        .filter((c) => c.command.trim())
        .map((c) => ({
          command: c.command.replace(/^\/+/, '').trim(),
          description: c.description.trim() || '-',
        }));

      let successCount = 0;
      for (const bot of connectedBots) {
        if (!bot.bot_token) continue;
        try {
          const r = await fetch(
            `https://api.telegram.org/bot${bot.bot_token}/setMyCommands`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ commands }),
            }
          );
          const d = await r.json();
          if (d.ok) successCount++;
        } catch {
          // skip individual bot errors
        }
      }
      toast({
        title: '✅ Команды применены',
        description: `Обновлено в ${successCount} из ${connectedBots.filter((b) => b.bot_token).length} бот(а/ов)`,
      });
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
    } finally {
      setIsDeployingCmds(false);
    }
  };

  // ── Buttons CRUD ──────────────────────────────────────────────────────────────

  const addButton = () => {
    const newId = crypto.randomUUID();
    setConfig((p) => ({
      ...p,
      extraButtons: [
        ...p.extraButtons,
        { id: newId, text: '🔘 Новая кнопка', type: 'url', value: '', enabled: true, sheetRanges: [] },
      ],
      menuOrder: [...p.menuOrder, { id: newId, kind: 'button' as const }],
    }));
    setExpandedButtons((prev) => new Set([...prev, newId]));
  };

  const updateButton = (id: string, patch: Partial<ExtraButton>) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));

  const deleteButton = (id: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.filter((b) => b.id !== id),
      menuOrder: p.menuOrder.filter((x) => x.id !== id),
    }));

  const updateMenuOrder = (id: string, patch: Partial<MenuOrderItem>) =>
    setConfig((p) => ({
      ...p,
      menuOrder: p.menuOrder.map((x) => x.id === id ? { ...x, ...patch } : x),
    }));

  const moveButton = (id: string, dir: 'up' | 'down') =>
    setConfig((p) => {
      const order = [...p.menuOrder];
      const i = order.findIndex((x) => x.id === id);
      if (dir === 'up' && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
      if (dir === 'down' && i < order.length - 1) [order[i], order[i + 1]] = [order[i + 1], order[i]];
      return { ...p, menuOrder: order };
    });

  const reorderExtraButtons = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setConfig((p) => {
      const arr = [...p.extraButtons];
      const fromIdx = arr.findIndex((b) => b.id === fromId);
      const toIdx = arr.findIndex((b) => b.id === toId);
      if (fromIdx < 0 || toIdx < 0) return p;
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return { ...p, extraButtons: arr };
    });
  };

  const reorderMenu = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setConfig((p) => {
      const order = [...p.menuOrder];
      const fromIdx = order.findIndex((x) => x.id === fromId);
      const toIdx = order.findIndex((x) => x.id === toId);
      if (fromIdx < 0 || toIdx < 0) return p;
      const [item] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, item);
      return { ...p, menuOrder: order };
    });
  };

  const mkSheetRange = (): SheetRange => ({
    id: crypto.randomUUID(),
    sheetName: '',
    cols: [{ id: crypto.randomUUID(), from: 'A', to: '' }],
    rows: [{ id: crypto.randomUUID(), from: '1', to: '50' }],
  });

  const addSheetRange = (btnId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: [...(b.sheetRanges ?? []), mkSheetRange()] }
          : b
      ),
    }));

  const updateSheetRange = (btnId: string, rangeId: string, patch: { sheetName: string }) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) => (r.id === rangeId ? { ...r, ...patch } : r)) }
          : b
      ),
    }));

  const deleteSheetRange = (btnId: string, rangeId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).filter((r) => r.id !== rangeId) }
          : b
      ),
    }));

  const addSheetRangeCol = (btnId: string, rangeId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, cols: [...r.cols, { id: crypto.randomUUID(), from: '', to: '' }] } : r) }
          : b
      ),
    }));

  const removeSheetRangeCol = (btnId: string, rangeId: string, pairId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, cols: r.cols.filter((c) => c.id !== pairId) } : r) }
          : b
      ),
    }));

  const updateSheetRangeCol = (btnId: string, rangeId: string, pairId: string, patch: Partial<{from: string; to: string; label: string}>) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, cols: r.cols.map((c) => c.id === pairId ? { ...c, ...patch } : c) } : r) }
          : b
      ),
    }));

  const addSheetRangeRow = (btnId: string, rangeId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, rows: [...r.rows, { id: crypto.randomUUID(), from: '', to: '' }] } : r) }
          : b
      ),
    }));

  const removeSheetRangeRow = (btnId: string, rangeId: string, pairId: string) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, rows: r.rows.filter((rw) => rw.id !== pairId) } : r) }
          : b
      ),
    }));

  const updateSheetRangeRow = (btnId: string, rangeId: string, pairId: string, patch: Partial<{from: string; to: string}>) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) =>
        b.id === btnId
          ? { ...b, sheetRanges: (b.sheetRanges ?? []).map((r) =>
              r.id === rangeId ? { ...r, rows: r.rows.map((rw) => rw.id === pairId ? { ...rw, ...patch } : rw) } : r) }
          : b
      ),
    }));

  // ── Commands CRUD ─────────────────────────────────────────────────────────────

  const addCommand = () =>
    setConfig((p) => ({
      ...p,
      botCommands: [
        ...p.botCommands,
        { id: crypto.randomUUID(), command: 'newcmd', description: 'Описание команды' },
      ],
    }));

  const updateCommand = (id: string, patch: Partial<BotCommand>) =>
    setConfig((p) => ({
      ...p,
      botCommands: p.botCommands.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  const deleteCommand = (id: string) =>
    setConfig((p) => ({ ...p, botCommands: p.botCommands.filter((c) => c.id !== id) }));

  // ── Message Templates CRUD ────────────────────────────────────────────────────

  const addTemplate = () => {
    const id = crypto.randomUUID();
    setConfig((p) => ({
      ...p,
      messageTemplates: [
        ...p.messageTemplates,
        {
          id,
          title: 'Новый шаблон',
          text: '',
          buttons: [],
          blocks: [{ id: crypto.randomUUID(), type: 'text' as const, content: '' }],
          trigger: 'template_' + id.slice(0, 6),
          enabled: true,
        },
      ],
      menuOrder: [...p.menuOrder, { id, kind: 'template' as const }],
    }));
    setExpandedTemplates((prev) => new Set([...prev, id]));
  };

  const updateTemplate = (id: string, patch: Partial<MessageTemplate>) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));

  const deleteTemplate = (id: string) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.filter((t) => t.id !== id),
      menuOrder: p.menuOrder.filter((x) => x.id !== id),
    }));

  const addTemplateBlock = (templateId: string, type: 'text' | 'button') =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) =>
        t.id === templateId
          ? {
              ...t,
              blocks: [
                ...t.blocks,
                type === 'text'
                  ? { id: crypto.randomUUID(), type: 'text' as const, content: '' }
                  : { id: crypto.randomUUID(), type: 'button' as const, btnType: 'copy' as ButtonBlockType, label: '📋 Скопировать', copyText: '' },
              ],
            }
          : t
      ),
    }));

  const updateBlock = (templateId: string, blockId: string, patch: Partial<TemplateBlock>) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) =>
        t.id === templateId
          ? { ...t, blocks: t.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as TemplateBlock) : b)) }
          : t
      ),
    }));

  const deleteBlock = (templateId: string, blockId: string) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) =>
        t.id === templateId ? { ...t, blocks: t.blocks.filter((b) => b.id !== blockId) } : t
      ),
    }));

  const moveBlock = (templateId: string, blockId: string, dir: 'up' | 'down') =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) => {
        if (t.id !== templateId) return t;
        const idx = t.blocks.findIndex((b) => b.id === blockId);
        if (idx < 0) return t;
        const newBlocks = [...t.blocks];
        const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= newBlocks.length) return t;
        [newBlocks[idx], newBlocks[swapIdx]] = [newBlocks[swapIdx], newBlocks[idx]];
        return { ...t, blocks: newBlocks };
      }),
    }));

  const reorderBlocks = (templateId: string, fromId: string, toId: string) => {
    if (fromId === toId) return;
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) => {
        if (t.id !== templateId) return t;
        const arr = [...t.blocks];
        const fromIdx = arr.findIndex((b) => b.id === fromId);
        const toIdx = arr.findIndex((b) => b.id === toId);
        if (fromIdx < 0 || toIdx < 0) return t;
        const [item] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, item);
        return { ...t, blocks: arr };
      }),
    }));
  };

  const addBlockFromSelection = (templateId: string) => {
    const sel = textSelections[templateId]?.trim();
    if (!sel) return;
    addTemplateBlock(templateId, 'button');
    // Update the last block (just added)
    setConfig((p) => {
      const tmpl = p.messageTemplates.find((t) => t.id === templateId);
      if (!tmpl) return p;
      const lastBlock = tmpl.blocks[tmpl.blocks.length - 1];
      const label = '📋 ' + (sel.length > 28 ? sel.slice(0, 28) + '…' : sel);
      return {
        ...p,
        messageTemplates: p.messageTemplates.map((t) =>
          t.id === templateId
            ? { ...t, blocks: t.blocks.map((b) => (b.id === lastBlock?.id ? { ...b, label, copyText: sel } : b)) }
            : t
        ),
      };
    });
    setTextSelections((prev) => ({ ...prev, [templateId]: '' }));
  };

  const handleTextareaSelect = useCallback((templateId: string) => {
    const el = textareaRefs.current[templateId];
    if (!el) return;
    const sel = el.value.slice(el.selectionStart, el.selectionEnd);
    setTextSelections((p) => ({ ...p, [templateId]: sel }));
  }, []);

  const toggleExpanded = (id: string) =>
    setExpandedTemplates((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleCopyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    });
  };

  // Wrap selected text in a textarea with an HTML tag pair
  const insertFormat = (refKey: string, templateId: string, blockId: string, open: string, close: string) => {
    const el = textareaRefs.current[refKey];
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const sel = val.slice(start, end) || 'текст';
    const newVal = val.slice(0, start) + open + sel + close + val.slice(end);
    updateBlock(templateId, blockId, { content: newVal } as any);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + open.length, start + open.length + sel.length);
    });
  };

  // Insert text at cursor position without wrapping
  const insertAtCursor = (refKey: string, templateId: string, blockId: string, text: string) => {
    const el = textareaRefs.current[refKey];
    if (!el) return;
    const start = el.selectionStart;
    const val = el.value;
    const newVal = val.slice(0, start) + text + val.slice(start);
    updateBlock(templateId, blockId, { content: newVal } as any);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  // Wrap selected text in <a href="..."> via URL prompt
  const insertLink = (refKey: string, templateId: string, blockId: string) => {
    const el = textareaRefs.current[refKey];
    if (!el) return;
    const url = window.prompt('URL ссылки:', 'https://');
    if (!url?.trim()) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const val = el.value;
    const text = val.slice(start, end) || 'ссылка';
    const tag = `<a href="${url.trim()}">${text}</a>`;
    const newVal = val.slice(0, start) + tag + val.slice(end > start ? end : start);
    updateBlock(templateId, blockId, { content: newVal } as any);
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Bot className="w-5 h-5 text-blue-500" />
            </div>
            <h2 className="text-xl font-bold">Настройка меню Telegram бота</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Приветственное сообщение, кнопки и команды, которые видят пользователи
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSendTest} disabled={isSendingTest}>
            {isSendingTest ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-1.5" />
            )}
            Тест
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-1.5" />
            )}
            Сохранить
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        {/* ── Left column ──────────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Welcome message */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-blue-500" />
                Приветственное сообщение
              </CardTitle>
              <CardDescription>
                Отображается каждый раз, когда пользователь пишет боту
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={config.welcomeMessage}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, welcomeMessage: e.target.value }))
                }
                placeholder="👋 Выберите действие:"
                className="resize-none min-h-[90px] font-mono text-sm"
                maxLength={500}
              />
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {QUICK_EMOJI.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="text-base hover:bg-muted rounded px-1 py-0.5 transition-colors"
                      onClick={() =>
                        setConfig((p) => ({ ...p, welcomeMessage: p.welcomeMessage + em }))
                      }
                    >
                      {em}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {config.welcomeMessage.length}/500
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Menu buttons */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Hash className="w-4 h-4 text-purple-500" />
                    Кнопки меню
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Кнопки отображаются под сообщением бота
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={addButton}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Добавить
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Custom buttons list */}
              {config.extraButtons.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6 border border-dashed rounded-lg">
                  Кастомных кнопок нет. Нажмите «Добавить».
                </div>
              ) : (
                <div className="space-y-2">
                  {config.extraButtons.map((btn, idx) => {
                    const isOpen = expandedButtons.has(btn.id);
                    return (
                    <div key={btn.id} className="rounded-lg border bg-card overflow-hidden">
                      {/* Collapsed header row */}
                      <div
                        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                        onClick={() => setExpandedButtons((prev) => {
                          const next = new Set(prev);
                          if (next.has(btn.id)) next.delete(btn.id); else next.add(btn.id);
                          return next;
                        })}
                      >
                        <button type="button" className="text-muted-foreground flex-shrink-0">
                          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <span className="text-[11px] flex-shrink-0 text-muted-foreground/60">
                          {BUTTON_TYPE_META[btn.type]?.label.split(' ')[0]}
                        </span>
                        <span className="text-sm font-medium flex-1 truncate">{btn.text || 'Без названия'}</span>
                        {/* Order arrows */}
                        <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            onClick={() => moveButton(btn.id, 'up')}
                            disabled={idx === 0}
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            onClick={() => moveButton(btn.id, 'down')}
                            disabled={idx === config.extraButtons.length - 1}
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const isNewRow = config.menuOrder.find(x => x.id === btn.id)?.newRow === true;
                            return (
                              <button
                                type="button"
                                title={isNewRow ? 'Всегда с новой строки (нажмите чтобы отменить)' : 'Добавить перенос строки перед кнопкой'}
                                onClick={() => updateMenuOrder(btn.id, { newRow: !isNewRow })}
                                className={`p-1 rounded transition-colors ${isNewRow ? 'text-primary bg-primary/15' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'}`}
                              >
                                <CornerDownLeft className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}
                          <Switch
                            checked={btn.enabled !== false}
                            onCheckedChange={(v) => updateButton(btn.id, { enabled: v })}
                            className="scale-75"
                          />
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                            onClick={() => deleteButton(btn.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded editor */}
                      {isOpen && (
                        <div className="border-t px-3 py-3 space-y-2.5">
                          <Input
                            value={btn.text}
                            onChange={(e) => updateButton(btn.id, { text: e.target.value })}
                            placeholder="Текст кнопки (с эмодзи)"
                            className="text-sm h-8"
                          />
                          <div className="flex gap-2">
                            <Select
                              value={btn.type}
                              onValueChange={(v) =>
                                updateButton(btn.id, { type: v as ExtraButton['type'] })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs w-48 flex-shrink-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(BUTTON_TYPE_META) as ExtraButton['type'][]).map((k) => (
                                  <SelectItem key={k} value={k}>
                                    {BUTTON_TYPE_META[k].label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {btn.type !== 'google_sheet' && (
                              <Input
                                value={btn.value}
                                onChange={(e) => updateButton(btn.id, { value: e.target.value })}
                                placeholder={BUTTON_TYPE_META[btn.type].placeholder}
                                className="text-sm h-8 flex-1 min-w-0"
                              />
                            )}
                          </div>
                          {/* Hint for current type */}
                          {btn.type !== 'google_sheet' && (
                            <p className="text-[10px] text-muted-foreground/55 flex items-start gap-1">
                              <Info className="w-3 h-3 flex-shrink-0 mt-px" />
                              {BUTTON_TYPE_META[btn.type].hint}
                            </p>
                          )}
                          {btn.type === 'google_sheet' && (
                            <div className="space-y-2">
                              {/* Range list */}
                              {(btn.sheetRanges ?? []).length === 0 ? (
                                <div className="text-xs text-muted-foreground text-center py-2 border border-dashed border-green-500/20 rounded-lg">
                                  Нажмите «+ Диапазон» чтобы выбрать столбцы и строки
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  {(btn.sheetRanges ?? []).map((rng, ri) => {
                                    // Build preview strings for all col×row combos
                                    const sh = rng.sheetName ? `${rng.sheetName}!` : '';
                                    const previewParts: string[] = [];
                                    for (const col of rng.cols) {
                                      for (const row of rng.rows) {
                                        const cf = (col.from || '').toUpperCase();
                                        const ct = (col.to || col.from || '').toUpperCase() || cf;
                                        const rf = (row.from || '').trim();
                                        const rt = (row.to || '').trim();
                                        let seg: string;
                                        if (!cf && rf) seg = `${rf}:${rt || rf}`;
                                        else if (cf && !rf) seg = ct ? `${cf}:${ct}` : `${cf}`;
                                        else if (cf && rf) seg = `${cf}${rf}:${ct || cf}${rt || rf}`;
                                        else seg = 'A:Z';
                                        previewParts.push(`${sh}${seg}`);
                                      }
                                    }
                                    const preview = previewParts.join(', ') || `${sh}A:Z`;
                                    return (
                                      <div key={rng.id} className="rounded-lg border border-green-500/20 bg-green-500/5 p-2 space-y-1.5">
                                        <div className="flex items-center gap-1 text-[10px] text-green-400/80 font-medium">
                                          <span className="flex-1">Диапазон {ri + 1}</span>
                                          <code className="bg-green-500/10 px-1.5 py-0.5 rounded font-mono text-green-300 max-w-[160px] truncate">{preview}</code>
                                          <button type="button"
                                            onClick={() => deleteSheetRange(btn.id, rng.id)}
                                            className="p-0.5 rounded hover:bg-destructive/20 hover:text-destructive text-muted-foreground transition-colors">
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                        {/* Sheet name */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground/60 w-11 flex-shrink-0">ЛИСТ</span>
                                          <Input value={rng.sheetName}
                                            onChange={(e) => updateSheetRange(btn.id, rng.id, { sheetName: e.target.value })}
                                            placeholder="Лист1"
                                            className="h-6 text-xs flex-1 font-mono" />
                                        </div>
                                        {/* Columns */}
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-muted-foreground/60">СТОЛБЦЫ</span>
                                          <div className="flex items-start gap-1.5 overflow-x-auto pb-0.5">
                                            {rng.cols.map((col, ci) => (
                                              <>
                                                {ci > 0 && (
                                                  <span className="text-green-400/60 font-bold text-base self-center flex-shrink-0 leading-none">+</span>
                                                )}
                                                <div key={col.id} className="flex flex-col gap-1 flex-shrink-0 bg-green-500/5 border border-green-500/20 rounded-md p-1.5">
                                                  <Input
                                                    value={col.label ?? ''}
                                                    onChange={(e) => updateSheetRangeCol(btn.id, rng.id, col.id, { label: e.target.value })}
                                                    placeholder="Название..."
                                                    className="h-5 text-[10px] w-24 font-medium" />
                                                  <div className="flex items-center gap-0.5 justify-center">
                                                    <Input value={col.from}
                                                      onChange={(e) => updateSheetRangeCol(btn.id, rng.id, col.id, { from: e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase() })}
                                                      placeholder="A"
                                                      className="h-5 text-xs w-9 font-mono text-center" />
                                                    <span className="text-muted-foreground text-[9px]">—</span>
                                                    <Input value={col.to}
                                                      onChange={(e) => updateSheetRangeCol(btn.id, rng.id, col.id, { to: e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase() })}
                                                      placeholder={col.from || 'A'}
                                                      className="h-5 text-xs w-9 font-mono text-center" />
                                                    {ci > 0 && (
                                                      <button type="button" onClick={() => removeSheetRangeCol(btn.id, rng.id, col.id)}
                                                        className="p-0.5 rounded hover:text-destructive text-muted-foreground/40 transition-colors">
                                                        <Trash2 className="w-2.5 h-2.5" />
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                              </>
                                            ))}
                                            <button type="button" onClick={() => addSheetRangeCol(btn.id, rng.id)}
                                              className="self-center flex-shrink-0 h-7 px-2 rounded text-[10px] text-green-400 border border-green-500/30 hover:bg-green-500/10 transition-colors flex items-center gap-0.5"
                                              title="Добавить столбец">
                                              <Plus className="w-2.5 h-2.5" />+ стлб
                                            </button>
                                          </div>
                                        </div>
                                        {/* Rows */}
                                        <div className="space-y-1">
                                          <span className="text-[10px] text-muted-foreground/60">СТРОКИ</span>
                                          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                                            {rng.rows.map((row, rwi) => (
                                              <>
                                                {rwi > 0 && (
                                                  <span className="text-green-400/60 font-bold text-base flex-shrink-0 leading-none">+</span>
                                                )}
                                                <div key={row.id} className="flex items-center gap-0.5 flex-shrink-0 bg-green-500/5 border border-green-500/20 rounded-md px-1.5 py-1">
                                                  <Input value={row.from}
                                                    onChange={(e) => updateSheetRangeRow(btn.id, rng.id, row.id, { from: e.target.value.replace(/\D/g, '') })}
                                                    placeholder="1"
                                                    className="h-5 text-xs w-12 font-mono text-center" />
                                                  <span className="text-muted-foreground text-[9px]">—</span>
                                                  <Input value={row.to}
                                                    onChange={(e) => updateSheetRangeRow(btn.id, rng.id, row.id, { to: e.target.value.replace(/\D/g, '') })}
                                                    placeholder="50"
                                                    className="h-5 text-xs w-12 font-mono text-center" />
                                                  {rwi > 0 && (
                                                    <button type="button" onClick={() => removeSheetRangeRow(btn.id, rng.id, row.id)}
                                                      className="p-0.5 rounded hover:text-destructive text-muted-foreground/40 transition-colors">
                                                      <Trash2 className="w-2.5 h-2.5" />
                                                    </button>
                                                  )}
                                                </div>
                                              </>
                                            ))}
                                            <button type="button" onClick={() => addSheetRangeRow(btn.id, rng.id)}
                                              className="flex-shrink-0 h-7 px-2 rounded text-[10px] text-green-400 border border-green-500/30 hover:bg-green-500/10 transition-colors flex items-center gap-0.5"
                                              title="Добавить строки">
                                              <Plus className="w-2.5 h-2.5" />+ стрк
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <Button size="sm" variant="outline"
                                className="h-6 text-xs w-full border-green-500/30 text-green-400 hover:bg-green-500/10"
                                onClick={() => addSheetRange(btn.id)}>
                                <Plus className="w-3 h-3 mr-1" />
                                + Диапазон
                              </Button>
                              <p className="text-[10px] text-muted-foreground/60">
                                При нажатии бот прочитает все диапазоны и пришлёт данные. Таблица из настроек профиля.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bot commands */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Hash className="w-4 h-4 text-green-500" />
                    Команды бота
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    /команды в левом нижнем меню Telegram
                  </CardDescription>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="outline" onClick={addCommand}>
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    Добавить
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleDeployCommands}
                    disabled={isDeployingCmds}
                  >
                    {isDeployingCmds ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5 mr-1" />
                    )}
                    Загрузить в бота
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {config.botCommands.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6 border border-dashed rounded-lg">
                  Команд нет. Нажмите «Добавить».
                </div>
              ) : (
                config.botCommands.map((cmd) => (
                  <div key={cmd.id} className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm font-mono flex-shrink-0">/</span>
                    <Input
                      value={cmd.command.replace(/^\/+/, '')}
                      onChange={(e) =>
                        updateCommand(cmd.id, {
                          command: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase(),
                        })
                      }
                      placeholder="start"
                      className="font-mono text-sm h-8 w-28 flex-shrink-0"
                    />
                    <Input
                      value={cmd.description}
                      onChange={(e) => updateCommand(cmd.id, { description: e.target.value })}
                      placeholder="Описание команды"
                      className="text-sm h-8 flex-1"
                    />
                    <button
                      type="button"
                      className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors flex-shrink-0"
                      onClick={() => deleteCommand(cmd.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
              <p className="text-xs text-muted-foreground pt-1">
                После редактирования нажмите «Загрузить в бота» для применения команд в Telegram.
              </p>
            </CardContent>
          </Card>

          {/* Message templates with copy buttons */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4 text-orange-500" />
                    Шаблоны с кнопками копирования
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Текстовые блоки (реквизиты, данные) с кнопками «Скопировать»
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={addTemplate}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Добавить
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {config.messageTemplates.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-8 border border-dashed rounded-lg space-y-2">
                  <ClipboardCopy className="w-8 h-8 mx-auto opacity-20" />
                  <p>Шаблонов нет. Нажмите «Добавить».</p>
                  <p className="text-xs opacity-60">Пример: реквизиты банка, IBAN, телефон — с кнопками копирования</p>
                </div>
              ) : (
                config.messageTemplates.map((tmpl) => {
                  const isOpen = expandedTemplates.has(tmpl.id);
                  return (
                    <div key={tmpl.id} className="rounded-lg border bg-card overflow-hidden">
                      {/* Header row */}
                      <div
                        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                        onClick={() => toggleExpanded(tmpl.id)}
                      >
                        <button type="button" className="text-muted-foreground flex-shrink-0">
                          {isOpen
                            ? <ChevronDown className="w-4 h-4" />
                            : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <FileText className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                        <span className="text-sm font-medium flex-1 truncate">{tmpl.title || 'Без названия'}</span>
                        {tmpl.trigger && (
                          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                            /{tmpl.trigger}
                          </span>
                        )}
                        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const isNewRow = config.menuOrder.find(x => x.id === tmpl.id)?.newRow === true;
                            return (
                              <button
                                type="button"
                                title={isNewRow ? 'Всегда с новой строки (нажмите чтобы отменить)' : 'Добавить перенос строки перед шаблоном'}
                                onClick={() => updateMenuOrder(tmpl.id, { newRow: !isNewRow })}
                                className={`p-1 rounded transition-colors ${isNewRow ? 'text-primary bg-primary/15' : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted'}`}
                              >
                                <CornerDownLeft className="w-3.5 h-3.5" />
                              </button>
                            );
                          })()}
                          <Switch
                            checked={tmpl.enabled}
                            onCheckedChange={(v) => updateTemplate(tmpl.id, { enabled: v })}
                            className="scale-75"
                          />
                          <button
                            type="button"
                            className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors"
                            onClick={() => deleteTemplate(tmpl.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded content */}
                      {isOpen && (
                        <div className="border-t px-3 py-3 space-y-4">
                          {/* Title + trigger */}
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Название (для администратора)</Label>
                              <Input
                                value={tmpl.title}
                                onChange={(e) => updateTemplate(tmpl.id, { title: e.target.value })}
                                placeholder="Реквизиты банка"
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Триггер <span className="text-muted-foreground/50">(callback_data)</span>
                              </Label>
                              <div className="flex items-center gap-1">
                                <span className="text-muted-foreground text-sm">/</span>
                                <Input
                                  value={tmpl.trigger}
                                  onChange={(e) =>
                                    updateTemplate(tmpl.id, {
                                      trigger: e.target.value.replace(/[^a-z0-9_]/gi, '').toLowerCase(),
                                    })
                                  }
                                  placeholder="requisites"
                                  className="h-8 text-sm font-mono"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Block editor */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-muted-foreground">Содержимое сообщения</Label>
                              <div className="flex gap-1.5">
                                <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                                  onClick={() => addTemplateBlock(tmpl.id, 'text')}>
                                  <Plus className="w-3 h-3 mr-0.5" />
                                  Текст
                                </Button>
                                <Button size="sm" variant="outline" className="h-6 text-xs px-2"
                                  onClick={() => addTemplateBlock(tmpl.id, 'button')}>
                                  <ClipboardCopy className="w-3 h-3 mr-0.5" />
                                  Кнопка
                                </Button>
                              </div>
                            </div>

                            {(tmpl.blocks ?? []).length === 0 ? (
                              <div className="text-xs text-muted-foreground text-center py-4 border border-dashed rounded-lg">
                                Нажмите «Текст» или «Кнопка» чтобы добавить блок
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {(tmpl.blocks ?? []).map((block, bIdx) => {
                                  const isDragOver = dragOverBlock?.templateId === tmpl.id && dragOverBlock?.blockId === block.id;
                                  return (
                                  <div
                                    key={block.id}
                                    data-block-id={block.id}
                                    data-tmpl-id={tmpl.id}
                                    draggable
                                    onDragStart={(e) => {
                                      if (!blockGripDown.current) { e.preventDefault(); return; }
                                      blockGripDown.current = false;
                                      dragBlock.current = { templateId: tmpl.id, blockId: block.id };
                                      dragBlockStartPos.current = { x: e.clientX, y: e.clientY };
                                    }}
                                    onDragOver={(e) => {
                                      e.preventDefault();
                                      if (!dragBlockStartPos.current) return;
                                      const dx = Math.abs(e.clientX - dragBlockStartPos.current.x);
                                      const dy = Math.abs(e.clientY - dragBlockStartPos.current.y);
                                      if (dy > dx) setDragOverBlock({ templateId: tmpl.id, blockId: block.id });
                                    }}
                                    onDragLeave={() => setDragOverBlock(null)}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      if (dragBlock.current && dragBlock.current.templateId === tmpl.id) {
                                        reorderBlocks(tmpl.id, dragBlock.current.blockId, block.id);
                                      }
                                      dragBlock.current = null;
                                      dragBlockStartPos.current = null;
                                      setDragOverBlock(null);
                                    }}
                                    onDragEnd={() => { blockGripDown.current = false; dragBlock.current = null; dragBlockStartPos.current = null; setDragOverBlock(null); }}
                                    className={`rounded-lg border p-2.5 space-y-1.5 transition-all select-none ${
                                      block.type === 'button' ? 'bg-blue-500/5 border-blue-500/20' : 'bg-muted/10'
                                    } ${isDragOver ? 'ring-2 ring-blue-400/60 scale-[1.01]' : ''}`}
                                  >
                                    {/* Block header: drag handle + type badge + order arrows + delete */}
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors flex-shrink-0"
                                        title="Перетащить для изменения порядка"
                                        onPointerDown={() => { blockGripDown.current = true; }}
                                        onPointerUp={() => { blockGripDown.current = false; }}
                                        onTouchStart={() => { touchBlockDrag.current = { templateId: tmpl.id, blockId: block.id }; }}
                                        onTouchMove={(e) => {
                                          const touch = e.touches[0];
                                          const el = document.elementFromPoint(touch.clientX, touch.clientY);
                                          const blockEl = el?.closest('[data-block-id]');
                                          if (blockEl) {
                                            const tBlockId = blockEl.getAttribute('data-block-id');
                                            const tTmplId = blockEl.getAttribute('data-tmpl-id');
                                            if (tBlockId && tTmplId) setDragOverBlock({ templateId: tTmplId, blockId: tBlockId });
                                          }
                                        }}
                                        onTouchEnd={() => {
                                          if (touchBlockDrag.current && dragOverBlock &&
                                              touchBlockDrag.current.templateId === dragOverBlock.templateId &&
                                              touchBlockDrag.current.blockId !== dragOverBlock.blockId) {
                                            reorderBlocks(dragOverBlock.templateId, touchBlockDrag.current.blockId, dragOverBlock.blockId);
                                          }
                                          touchBlockDrag.current = null;
                                          blockGripDown.current = false;
                                          dragBlock.current = null;
                                          dragBlockStartPos.current = null;
                                          setDragOverBlock(null);
                                        }}
                                      >
                                        <GripVertical className="w-3.5 h-3.5" />
                                      </span>
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${block.type === 'button' ? 'bg-blue-500/20 text-blue-300' : 'bg-muted text-muted-foreground'}`}>
                                        {block.type === 'button'
                                          ? BUTTON_BLOCK_META[((block as any).btnType ?? 'copy') as ButtonBlockType].badge
                                          : '📝 ТЕКСТ'}
                                      </span>
                                      <div className="flex-1" />
                                      <button type="button"
                                        disabled={bIdx === 0}
                                        onClick={() => moveBlock(tmpl.id, block.id, 'up')}
                                        className="p-0.5 rounded hover:bg-muted disabled:opacity-25 transition-colors">
                                        <ArrowUp className="w-3 h-3" />
                                      </button>
                                      <button type="button"
                                        disabled={bIdx === (tmpl.blocks ?? []).length - 1}
                                        onClick={() => moveBlock(tmpl.id, block.id, 'down')}
                                        className="p-0.5 rounded hover:bg-muted disabled:opacity-25 transition-colors">
                                        <ArrowDown className="w-3 h-3" />
                                      </button>
                                      <button type="button"
                                        onClick={() => deleteBlock(tmpl.id, block.id)}
                                        className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors">
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>

                                    {block.type === 'text' ? (
                                      /* Text block */
                                      <div className="space-y-1">
                                        {/* Formatting toolbar */}
                                        <div className="flex items-center gap-0.5 border border-border/40 rounded-md px-1 py-0.5 bg-muted/20 flex-wrap">
                                          {([
                                            { open: '<b>',           close: '</b>',           Icon: Bold,          title: 'Жирный (<b>)' },
                                            { open: '<i>',           close: '</i>',           Icon: Italic,        title: 'Курсив (<i>)' },
                                            { open: '<u>',           close: '</u>',           Icon: Underline,     title: 'Подчёркнутый (<u>)' },
                                            { open: '<s>',           close: '</s>',           Icon: Strikethrough, title: 'Зачёркнутый (<s>)' },
                                            { open: '<code>',        close: '</code>',        Icon: Code2,         title: 'Код (<code>)' },
                                            { open: '<tg-spoiler>',  close: '</tg-spoiler>',  Icon: EyeOff,        title: 'Спойлер (<tg-spoiler>)' },
                                          ] as { open: string; close: string; Icon: React.FC<{ className?: string }>; title: string }[]).map(({ open, close, Icon, title }) => (
                                            <button key={open} type="button" title={title}
                                              className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                              onMouseDown={(e) => { e.preventDefault(); insertFormat(`${tmpl.id}_${block.id}`, tmpl.id, block.id, open, close); }}>
                                              <Icon className="w-3 h-3" />
                                            </button>
                                          ))}
                                          <div className="w-px h-3.5 bg-border/50 mx-0.5 self-center" />
                                          <button type="button" title="Ссылка (<a href=...>)"
                                            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                            onMouseDown={(e) => { e.preventDefault(); insertLink(`${tmpl.id}_${block.id}`, tmpl.id, block.id); }}>
                                            <Link2 className="w-3 h-3" />
                                          </button>
                                          <button type="button" title="@Упоминание"
                                            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                            onMouseDown={(e) => { e.preventDefault(); insertFormat(`${tmpl.id}_${block.id}`, tmpl.id, block.id, '@', ''); }}>
                                            <AtSign className="w-3 h-3" />
                                          </button>
                                          <button type="button" title="#Хэштег"
                                            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                                            onMouseDown={(e) => { e.preventDefault(); insertFormat(`${tmpl.id}_${block.id}`, tmpl.id, block.id, '#', ''); }}>
                                            <Hash className="w-3 h-3" />
                                          </button>
                                          <div className="w-px h-3.5 bg-border/50 mx-0.5 self-center" />
                                          {/* Color emoji palette — Telegram does not support HTML colors,
                                              so we offer colored emoji squares as visual color markers */}
                                          {['🔴','🟠','🟡','🟢','🔵','🟣','🟤','⚫','⚪'].map((em) => (
                                            <button key={em} type="button" title={`Цвет ${em} (emoji)`}
                                              className="text-[11px] leading-none p-0.5 rounded hover:bg-muted/80 transition-colors"
                                              onMouseDown={(e) => { e.preventDefault(); insertAtCursor(`${tmpl.id}_${block.id}`, tmpl.id, block.id, em); }}>
                                              {em}
                                            </button>
                                          ))}
                                        </div>
                                        <Textarea
                                          ref={(el) => { textareaRefs.current[`${tmpl.id}_${block.id}`] = el; }}
                                          value={block.content}
                                          onChange={(e) => updateBlock(tmpl.id, block.id, { content: e.target.value } as any)}
                                          onSelect={() => handleTextareaSelect(`${tmpl.id}_${block.id}`)}
                                          onMouseUp={() => handleTextareaSelect(`${tmpl.id}_${block.id}`)}
                                          onKeyUp={() => handleTextareaSelect(`${tmpl.id}_${block.id}`)}
                                          placeholder={"Реквизиты для пожертвований:\n\nБанк: PrivatBank\nКарта: 4149 6090 1234 5678"}
                                          className="resize-y min-h-[80px] text-sm font-mono leading-relaxed"
                                        />
                                        <p className="text-[10px] text-muted-foreground">
                                          {block.content.length} симв. · HTML: <code className="bg-muted px-0.5 rounded">&lt;b&gt;</code> <code className="bg-muted px-0.5 rounded">&lt;i&gt;</code> <code className="bg-muted px-0.5 rounded">&lt;code&gt;</code>
                                        </p>
                                        {/* Selection bar */}
                                        {textSelections[`${tmpl.id}_${block.id}`]?.trim() && (
                                          <div className="flex items-center gap-1.5 rounded-md bg-blue-500/10 border border-blue-500/20 px-2 py-1.5">
                                            <span className="text-[10px] text-blue-300 flex-1 min-w-0 truncate font-mono">
                                              «{textSelections[`${tmpl.id}_${block.id}`].slice(0, 45)}»
                                            </span>
                                            <Button type="button" size="sm"
                                              className="h-5 text-[10px] px-2 bg-blue-600 hover:bg-blue-500 text-white flex-shrink-0"
                                              onClick={() => addBlockFromSelection(tmpl.id)}>
                                              <Plus className="w-2.5 h-2.5 mr-0.5" />
                                              → Кнопка
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      /* Button block */
                                      <div className="space-y-1.5">
                                        {/* Type selector */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground/60 w-9 flex-shrink-0">ТИП</span>
                                          <Select
                                            value={(block as any).btnType ?? 'copy'}
                                            onValueChange={(v) => updateBlock(tmpl.id, block.id, { btnType: v } as any)}
                                          >
                                            <SelectTrigger className="h-7 text-xs flex-1">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {(Object.keys(BUTTON_BLOCK_META) as ButtonBlockType[]).map((k) => (
                                                <SelectItem key={k} value={k}>{BUTTON_BLOCK_META[k].label}</SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        {/* Button label */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground/60 w-9 flex-shrink-0">ТЕКСТ</span>
                                          <Input
                                            value={block.label}
                                            onChange={(e) => updateBlock(tmpl.id, block.id, { label: e.target.value } as any)}
                                            placeholder="📋 Текст кнопки"
                                            className="h-7 text-xs flex-1"
                                          />
                                        </div>
                                        <p className="text-[9px] text-muted-foreground/40 pl-[2.75rem]">
                                          Telegram не поддерживает форматирование в тексте кнопок. Используйте emoji для обозначения цвета: 🔴🟠🟡🟢🔵🟣
                                        </p>
                                        {/* Value */}
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground/60 w-9 flex-shrink-0 truncate">
                                            {BUTTON_BLOCK_META[((block as any).btnType ?? 'copy') as ButtonBlockType].valueLabel}
                                          </span>
                                          <Input
                                            value={block.copyText}
                                            onChange={(e) => updateBlock(tmpl.id, block.id, { copyText: e.target.value } as any)}
                                            placeholder={BUTTON_BLOCK_META[((block as any).btnType ?? 'copy') as ButtonBlockType].valuePlaceholder}
                                            className="h-7 text-xs flex-1 font-mono"
                                          />
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                        </div>
                      )}
                    </div>
                  );
                })
              )}
              {config.messageTemplates.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <Zap className="w-3 h-3 inline mr-1" />
                  Добавьте в «Кнопки меню» кнопку с типом «Действие бота» и callback_data = триггеру шаблона.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right column ─────────────────────────────────────────────────── */}
        <div className="space-y-5">
          {/* Layout editor */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-blue-500" />
                Редактор расположения
              </CardTitle>
              <p className="text-[11px] text-muted-foreground">
                Перетаскивайте кнопки прямо в окне бота
              </p>
            </CardHeader>
            <CardContent>
              <TelegramLayoutEditor
                config={config}
                onReorderMenu={reorderMenu}
                onChangeLayout={(s) => setConfig((p) => ({ ...p, layoutSettings: s }))}
              />
            </CardContent>
          </Card>

          {/* Connected bots */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="w-4 h-4 text-muted-foreground" />
                Подключённые боты
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectedBots.length === 0 ? (
                <div className="text-center py-4">
                  <XCircle className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Нет активных ботов</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Подключите бота в разделе «Настройки»
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {connectedBots.map((bot, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                    >
                      <div className="w-7 h-7 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3.5 h-3.5 text-blue-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {bot.registered_name || `Chat ${bot.telegram_chat_id}`}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {bot.bot_token ? `${bot.bot_token.slice(0, 8)}…` : 'Общий бот'}
                        </div>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              )}

              {connectedBots.length > 0 && (
                <>
                  <Separator />
                  <Button
                    className="w-full"
                    variant="outline"
                    size="sm"
                    onClick={handleSendTest}
                    disabled={isSendingTest}
                  >
                    {isSendingTest ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    Отправить тестовое сообщение
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

