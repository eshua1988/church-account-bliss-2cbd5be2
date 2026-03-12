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
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ExtraButton {
  id: string;
  text: string;
  type: 'url' | 'copy' | 'callback' | 'google_sheet';
  value: string;
}

interface BotCommand {
  id: string;
  command: string;
  description: string;
}

interface TemplateCopyButton {
  id: string;
  label: string;    // button text
  copyText: string; // text copied to clipboard
}

interface MessageTemplate {
  id: string;
  title: string;          // admin label
  text: string;           // message body
  buttons: TemplateCopyButton[];
  trigger: string;        // callback_data that triggers this template
  enabled: boolean;
}

interface MenuConfig {
  welcomeMessage: string;
  extraButtons: ExtraButton[];
  showPayoutLinks: boolean;
  botCommands: BotCommand[];
  messageTemplates: MessageTemplate[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const defaultConfig: MenuConfig = {
  welcomeMessage: '👋 Выберите действие:',
  extraButtons: [],
  showPayoutLinks: true,
  botCommands: [
    { id: '1', command: 'start', description: 'Главное меню' },
    { id: '2', command: 'help', description: 'Помощь и инструкция' },
  ],
  messageTemplates: [],
};

const BUTTON_TYPE_META = {
  url: { label: '🔗 URL-ссылка', placeholder: 'https://example.com' },
  copy: { label: '⎘ Скопировать текст', placeholder: 'Текст для копирования' },
  callback: { label: '⚡ Действие бота', placeholder: 'callback_data' },
  google_sheet: { label: '📈 Google Таблица', placeholder: 'Лист1!A1:D20' },
} as const;

const QUICK_EMOJI = ['👋', '✅', '🔔', '📋', '💰', '📊', '⚙️', '🏠', '📱', '🔍'];

// ─── Telegram mock preview ────────────────────────────────────────────────────

const TelegramPreview = ({ config }: { config: MenuConfig }) => {
  const allButtons: Array<{ text: string; type: string }> = [
    ...(config.showPayoutLinks
      ? [{ text: '🔗 Ссылка Ордера расходов - Скопировать', type: 'copy' }]
      : []),
    ...config.extraButtons,
  ];

  return (
    <div className="bg-[#17212b] rounded-2xl overflow-hidden shadow-xl border border-white/5 select-none">
      {/* Header bar */}
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
      </div>

      {/* Chat area */}
      <div className="px-3 py-4 min-h-[160px]">
        <div className="flex items-end gap-1.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0 flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="bg-[#232e3c] rounded-2xl rounded-bl-sm px-3 py-2 max-w-[85%] space-y-2">
            <p className="text-white text-[12px] leading-relaxed whitespace-pre-wrap break-words">
              {config.welcomeMessage || '👋 Выберите действие:'}
            </p>
            {allButtons.length > 0 && (
              <div className="border-t border-white/10 pt-2 space-y-1">
                {allButtons.map((btn, i) => (
                  <div
                    key={i}
                    className="bg-[#2b5278]/80 rounded-lg px-2.5 py-1.5 text-center text-[11px] text-[#6ab3f3] truncate"
                  >
                    {btn.text}
                    {btn.type === 'url' && <span className="ml-1 opacity-60">↗</span>}
                    {btn.type === 'copy' && <span className="ml-1 opacity-60">⎘</span>}
                    {btn.type === 'google_sheet' && <span className="ml-1 opacity-60">📈</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {allButtons.length === 0 && (
          <p className="text-white/20 text-[11px] text-center mt-4">
            Кнопки не добавлены
          </p>
        )}
      </div>

      {/* Input bar mock */}
      <div className="bg-[#242f3d] px-3 py-2 flex items-center gap-2">
        <div className="flex-1 bg-[#17212b] rounded-xl px-3 py-1.5">
          <span className="text-white/20 text-xs">Написать сообщение...</span>
        </div>
        <div className="w-7 h-7 rounded-full bg-blue-500/20 flex items-center justify-center">
          <Send className="w-3.5 h-3.5 text-blue-400" />
        </div>
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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // templateId → currently selected text in its textarea
  const [textSelections, setTextSelections] = useState<Record<string, string>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [connectedBots, setConnectedBots] = useState<
    Array<{ bot_token: string | null; telegram_chat_id: number; registered_name?: string | null }>
  >([]);

  // ── Load config ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;
    (async () => {
      setIsLoading(true);
      try {
        const [cfgRes, botsRes] = await Promise.all([
          supabase
            .from('telegram_bot_config')
            .select('welcome_message, extra_buttons, show_payout_links, bot_commands, message_templates')
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
          setConfig({
            welcomeMessage: d.welcome_message ?? defaultConfig.welcomeMessage,
            extraButtons: (d.extra_buttons as ExtraButton[]) ?? [],
            showPayoutLinks: d.show_payout_links !== false,
            botCommands: (d.bot_commands as BotCommand[]) ?? defaultConfig.botCommands,
            messageTemplates: (d.message_templates as MessageTemplate[]) ?? [],
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
          show_payout_links: config.showPayoutLinks,
          bot_commands: config.botCommands,
          message_templates: config.messageTemplates,
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

  const addButton = () =>
    setConfig((p) => ({
      ...p,
      extraButtons: [
        ...p.extraButtons,
        { id: crypto.randomUUID(), text: '🔘 Новая кнопка', type: 'url', value: '' },
      ],
    }));

  const updateButton = (id: string, patch: Partial<ExtraButton>) =>
    setConfig((p) => ({
      ...p,
      extraButtons: p.extraButtons.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));

  const deleteButton = (id: string) =>
    setConfig((p) => ({ ...p, extraButtons: p.extraButtons.filter((b) => b.id !== id) }));

  const moveButton = (id: string, dir: 'up' | 'down') =>
    setConfig((p) => {
      const arr = [...p.extraButtons];
      const i = arr.findIndex((b) => b.id === id);
      if (dir === 'up' && i > 0) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
      if (dir === 'down' && i < arr.length - 1) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      return { ...p, extraButtons: arr };
    });

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
          trigger: 'template_' + id.slice(0, 6),
          enabled: true,
        },
      ],
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
    }));

  const addTemplateButton = (templateId: string) =>
    updateTemplate(templateId, {
      buttons: [
        ...(config.messageTemplates.find((t) => t.id === templateId)?.buttons ?? []),
        { id: crypto.randomUUID(), label: '📋 Скопировать', copyText: '' },
      ],
    });

  const updateTemplateButton = (templateId: string, btnId: string, patch: Partial<TemplateCopyButton>) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) =>
        t.id === templateId
          ? { ...t, buttons: t.buttons.map((b) => (b.id === btnId ? { ...b, ...patch } : b)) }
          : t
      ),
    }));

  const deleteTemplateButton = (templateId: string, btnId: string) =>
    setConfig((p) => ({
      ...p,
      messageTemplates: p.messageTemplates.map((t) =>
        t.id === templateId ? { ...t, buttons: t.buttons.filter((b) => b.id !== btnId) } : t
      ),
    }));

  const handleTextareaSelect = useCallback((templateId: string) => {
    const el = textareaRefs.current[templateId];
    if (!el) return;
    const sel = el.value.slice(el.selectionStart, el.selectionEnd);
    setTextSelections((p) => ({ ...p, [templateId]: sel }));
  }, []);

  const addTemplateButtonFromSelection = (templateId: string) => {
    const sel = textSelections[templateId]?.trim();
    if (!sel) return;
    const label = '📋 ' + (sel.length > 28 ? sel.slice(0, 28) + '…' : sel);
    updateTemplate(templateId, {
      buttons: [
        ...(config.messageTemplates.find((t) => t.id === templateId)?.buttons ?? []),
        { id: crypto.randomUUID(), label, copyText: sel },
      ],
    });
    setTextSelections((p) => ({ ...p, [templateId]: '' }));
  };

  const wrapSelectionWithCode = (templateId: string) => {
    const el = textareaRefs.current[templateId];
    if (!el) return;
    const sel = textSelections[templateId]?.trim();
    if (!sel) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentText = config.messageTemplates.find((t) => t.id === templateId)?.text ?? '';
    const newText = currentText.slice(0, start) + `<code>${sel}</code>` + currentText.slice(end);
    updateTemplate(templateId, { text: newText });
    setTextSelections((p) => ({ ...p, [templateId]: '' }));
  };

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
              {/* Payout link auto-button toggle */}
              <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/30">
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Link2 className="w-3.5 h-3.5 text-blue-500" />
                    Кнопка ссылки ордера (авто)
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Автоматически добавляет кнопку копирования ссылки расходов
                  </div>
                </div>
                <Switch
                  checked={config.showPayoutLinks}
                  onCheckedChange={(v) => setConfig((p) => ({ ...p, showPayoutLinks: v }))}
                />
              </div>

              {/* Custom buttons list */}
              {config.extraButtons.length === 0 ? (
                <div className="text-center text-sm text-muted-foreground py-6 border border-dashed rounded-lg">
                  Кастомных кнопок нет. Нажмите «Добавить».
                </div>
              ) : (
                <div className="space-y-3">
                  {config.extraButtons.map((btn, idx) => (
                    <div key={btn.id} className="rounded-lg border bg-card p-3 space-y-2.5">
                      <div className="flex items-start gap-2">
                        {/* Order arrows */}
                        <div className="flex flex-col gap-0.5 pt-1">
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

                        {/* Fields */}
                        <div className="flex-1 space-y-2 min-w-0">
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
                              <SelectTrigger className="h-8 text-xs w-44 flex-shrink-0">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(BUTTON_TYPE_META) as ExtraButton['type'][]).map(
                                  (k) => (
                                    <SelectItem key={k} value={k}>
                                      {BUTTON_TYPE_META[k].label}
                                    </SelectItem>
                                  )
                                )}
                              </SelectContent>
                            </Select>
                            <Input
                              value={btn.value}
                              onChange={(e) => updateButton(btn.id, { value: e.target.value })}
                              placeholder={BUTTON_TYPE_META[btn.type].placeholder}
                              className="text-sm h-8 flex-1 min-w-0"
                            />
                          </div>
                          {btn.type === 'google_sheet' && (
                            <div className="flex items-start gap-1.5 rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-2 text-xs text-green-400">
                              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                              <div className="space-y-0.5">
                                <p className="font-medium">Диапазон ячеек Google Таблицы</p>
                                <p className="opacity-75">Формат: <code className="bg-green-500/10 px-1 rounded font-mono">Лист1!A1:D20</code> или просто <code className="bg-green-500/10 px-1 rounded font-mono">A1:D10</code></p>
                                <p className="opacity-75">При нажатии в Telegram бот прочитает эти ячейки и пришлёт данные. Таблица берётся из настроек профиля.</p>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Delete */}
                        <button
                          type="button"
                          className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors flex-shrink-0 mt-0.5"
                          onClick={() => deleteButton(btn.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
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
                        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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

                          {/* Message text */}
                          <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Текст сообщения</Label>
                            <div className="relative">
                              <Textarea
                                ref={(el) => { textareaRefs.current[tmpl.id] = el; }}
                                value={tmpl.text}
                                onChange={(e) => updateTemplate(tmpl.id, { text: e.target.value })}
                                onSelect={() => handleTextareaSelect(tmpl.id)}
                                onMouseUp={() => handleTextareaSelect(tmpl.id)}
                                onKeyUp={() => handleTextareaSelect(tmpl.id)}
                                placeholder={"Реквизиты для пожертвований:\n\nБанк: PrivatBank\nКарта: 4149 6090 1234 5678\nIBAN: UA12345678901234567890\n\nСпасибо! 🙏"}
                                className="resize-y min-h-[120px] text-sm font-mono leading-relaxed"
                              />
                            </div>
                            <div className="flex items-center justify-between">
                              <p className="text-xs text-muted-foreground">
                                {tmpl.text.length} симв. · Поддерживается HTML: <code className="bg-muted px-1 rounded">&lt;b&gt;</code> <code className="bg-muted px-1 rounded">&lt;i&gt;</code> <code className="bg-muted px-1 rounded">&lt;code&gt;</code>
                              </p>
                            </div>
                            {/* Selection action bar */}
                            {textSelections[tmpl.id]?.trim() && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/25 px-3 py-2">
                                  <ClipboardCopy className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                                  <span className="text-xs text-blue-300 flex-1 min-w-0 truncate">
                                    «<span className="font-mono font-medium">{textSelections[tmpl.id].length > 40 ? textSelections[tmpl.id].slice(0, 40) + '…' : textSelections[tmpl.id]}</span>»
                                  </span>
                                </div>
                                <div className="flex gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs flex-1 border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                                    onClick={() => wrapSelectionWithCode(tmpl.id)}
                                  >
                                    <code className="text-[10px] mr-1.5 bg-blue-500/20 px-1 rounded">&lt;code&gt;</code>
                                    Встроить в текст
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs flex-1 border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                                    onClick={() => addTemplateButtonFromSelection(tmpl.id)}
                                  >
                                    <Plus className="w-3 h-3 mr-1" />
                                    Кнопка снизу
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Copy buttons */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <ClipboardCopy className="w-3.5 h-3.5" />
                                Кнопки копирования
                              </Label>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 text-xs px-2"
                                onClick={() => addTemplateButton(tmpl.id)}
                              >
                                <Plus className="w-3 h-3 mr-0.5" />
                                Добавить вручную
                              </Button>
                            </div>

                            {tmpl.buttons.length === 0 ? (
                              <div className="text-xs text-muted-foreground text-center py-3 border border-dashed rounded-lg">
                                Выделите текст выше → появится кнопка «Добавить кнопку», или нажмите «Добавить вручную»
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {tmpl.buttons.map((btn) => (
                                  <div key={btn.id} className="rounded-lg border bg-muted/20 p-2.5 space-y-1.5">
                                    <div className="flex items-center gap-2">
                                      <div className="w-1 h-8 rounded-full bg-blue-500/40 flex-shrink-0" />
                                      <div className="flex-1 min-w-0 space-y-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">КНОПКА</span>
                                          <Input
                                            value={btn.label}
                                            onChange={(e) =>
                                              updateTemplateButton(tmpl.id, btn.id, { label: e.target.value })
                                            }
                                            placeholder="📋 Скопировать карту"
                                            className="h-7 text-xs flex-1"
                                          />
                                          <button
                                            type="button"
                                            className="p-1 rounded hover:bg-destructive/10 hover:text-destructive text-muted-foreground transition-colors flex-shrink-0"
                                            onClick={() => deleteTemplateButton(tmpl.id, btn.id)}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <ClipboardCopy className="w-3 h-3 text-muted-foreground/60 flex-shrink-0" />
                                          <Input
                                            value={btn.copyText}
                                            onChange={(e) =>
                                              updateTemplateButton(tmpl.id, btn.id, { copyText: e.target.value })
                                            }
                                            placeholder="Текст для копирования..."
                                            className="h-7 text-xs flex-1 font-mono"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Web preview */}
                          {(tmpl.text || tmpl.buttons.length > 0) && (
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Smartphone className="w-3.5 h-3.5" />
                                Предпросмотр · нажмите кнопку чтобы скопировать
                              </Label>
                              <div className="bg-[#17212b] rounded-xl p-3 space-y-2">
                                {tmpl.text && (
                                  <p
                                    className="text-white text-[12px] leading-relaxed whitespace-pre-wrap break-words bg-[#232e3c] rounded-xl rounded-tl-sm px-3 py-2"
                                    dangerouslySetInnerHTML={{
                                      __html: tmpl.text
                                        .replace(/&/g, '&amp;')
                                        .replace(/</g, '&lt;')
                                        .replace(/>/g, '&gt;')
                                        .replace(/&lt;b&gt;(.*?)&lt;\/b&gt;/g, '<strong>$1</strong>')
                                        .replace(/&lt;i&gt;(.*?)&lt;\/i&gt;/g, '<em>$1</em>')
                                        .replace(/&lt;code&gt;(.*?)&lt;\/code&gt;/g, '<code class="bg-white/10 px-1 rounded font-mono">$1</code>'),
                                    }}
                                  />
                                )}
                                {tmpl.buttons.length > 0 && (
                                  <div className="space-y-1">
                                    {tmpl.buttons.map((btn) => (
                                      <button
                                        key={btn.id}
                                        type="button"
                                        className={`w-full rounded-lg px-3 py-2 text-center text-[11px] transition-all duration-150 flex items-center justify-center gap-1.5 ${
                                          copiedId === btn.id
                                            ? 'bg-green-500/20 text-green-400'
                                            : 'bg-[#2b5278]/80 text-[#6ab3f3] hover:bg-[#2b5278] active:scale-95'
                                        }`}
                                        onClick={() =>
                                          btn.copyText && handleCopyToClipboard(btn.copyText, btn.id)
                                        }
                                        disabled={!btn.copyText}
                                      >
                                        {copiedId === btn.id ? (
                                          <>
                                            <CheckCircle2 className="w-3 h-3" />
                                            Скопировано!
                                          </>
                                        ) : (
                                          <>
                                            <ClipboardCopy className="w-3 h-3 opacity-70" />
                                            {btn.label || 'Кнопка'}
                                          </>
                                        )}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
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
          {/* Preview */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-muted-foreground" />
                Предварительный просмотр
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TelegramPreview config={config} />
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

