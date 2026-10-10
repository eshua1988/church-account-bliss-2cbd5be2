import { useEffect, useState } from 'react';
import { Cloud, ExternalLink, FileDown, Link as LinkIcon, Loader2, Table2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type LinkKind = 'payout' | 'deposit' | 'transactions' | 'analytics' | 'sheet' | 'cloud';

type LinkItem = {
  id: string;
  name: string;
  description: string;
  kind: LinkKind;
  href: string;
};

type CloudConnection = {
  id?: string;
  name?: string;
  provider?: string;
  folderUrl?: string;
  enabled?: boolean;
};

const labels: Record<LinkKind, string> = {
  payout: 'Расходные ордера',
  deposit: 'Приходные ордера',
  transactions: 'Таблицы транзакций',
  analytics: 'Аналитика',
  sheet: 'Google Таблица',
  cloud: 'Облако',
};

const validExternalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
};

const iconFor = (kind: LinkKind) => {
  if (kind === 'sheet') return <Table2 className="mt-0.5 h-5 w-5 text-primary" />;
  if (kind === 'cloud') return <Cloud className="mt-0.5 h-5 w-5 text-primary" />;
  if (kind === 'payout' || kind === 'deposit') return <FileDown className="mt-0.5 h-5 w-5 text-primary" />;
  return <LinkIcon className="mt-0.5 h-5 w-5 text-primary" />;
};

export const LinksPage = () => {
  const { user } = useAuth();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLinks([]);
      setLoading(false);
      return;
    }

    let active = true;
    const load = async (showLoader = false) => {
      if (showLoader) setLoading(true);
      const [payouts, transactions, exports, auth] = await Promise.all([
        supabase.from('shared_payout_links').select('id, token, name, link_type').eq('owner_user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('shared_transaction_links').select('id, token, name').eq('owner_user_id', user.id).order('created_at', { ascending: false }),
        (supabase.from('google_sheet_exports' as any) as any).select('id, export_type, spreadsheet_id, sheet_range').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.auth.getUser(),
      ]);
      const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
      const payoutLinks = (payouts.data || []).map((link: any): LinkItem => {
        const kind: LinkKind = link.link_type === 'deposit' ? 'deposit' : 'payout';
        return {
          id: `public-payout-${link.id}`,
          name: link.name || labels[kind],
          description: labels[kind],
          kind,
          href: `${base}/${kind}/${encodeURIComponent(link.token)}`,
        };
      });
      const transactionLinks = (transactions.data || []).map((link: any): LinkItem => {
        const kind: LinkKind = link.name?.startsWith('[Аналитика]') ? 'analytics' : 'transactions';
        return {
          id: `public-transaction-${link.id}`,
          name: link.name?.replace(/^\[Аналитика\]\s*/, '') || labels[kind],
          description: labels[kind],
          kind,
          href: `${base}/#/${kind}/${encodeURIComponent(link.token)}`,
        };
      });
      const sheetLinks = (exports.data || []).map((item: any): LinkItem => ({
        id: `sheet-${item.id}`,
        name: item.export_type === 'pdf' ? 'Экспорт данных PDF' : 'Экспорт транзакций',
        description: item.sheet_range || labels.sheet,
        kind: 'sheet',
        href: `https://docs.google.com/spreadsheets/d/${encodeURIComponent(item.spreadsheet_id)}`,
      }));
      const cloudConnections = (auth.data.user?.user_metadata?.cloud_connections || []) as CloudConnection[];
      const cloudLinks = cloudConnections.flatMap((connection, index): LinkItem[] => {
        const href = validExternalUrl(connection.folderUrl || '');
        if (connection.enabled === false || !href) return [];
        const providerName = connection.provider === 'google_drive' ? 'Google Drive' : 'Облако';
        return [{
          id: `cloud-${connection.id || index}`,
          name: connection.name || providerName,
          description: connection.provider === 'google_drive' ? 'Google Drive — ZIP-архивы' : 'Облачная папка',
          kind: 'cloud',
          href,
        }];
      });
      if (active) {
        setLinks([...payoutLinks, ...transactionLinks, ...sheetLinks, ...cloudLinks]);
        setLoading(false);
      }
    };
    void load(true);
    // Links are changed in settings, not continuously. A modest refresh keeps
    // another device's edits visible without issuing four database reads every
    // five seconds while this page is open.
    const interval = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user]);

  const description = 'Все публичные ссылки, настроенные Google Таблицы и облачные папки собраны в одном месте.';

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;
  return <section className="animate-fade-in mx-auto max-w-3xl space-y-5">
    <div><h1 className="text-2xl font-bold">Ссылки</h1><p className="text-muted-foreground">{description}</p></div>
    {links.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Ссылок пока нет. Добавьте экспорт, облачную папку или публичную ссылку в настройках.</div> : <div className="grid gap-3 sm:grid-cols-2">{links.map(link => <div key={link.id} className="rounded-xl border bg-card p-4"><div className="mb-4 flex items-start gap-3">{iconFor(link.kind)}<div><p className="font-semibold">{link.name}</p><p className="text-sm text-muted-foreground">{link.description}</p></div></div><Button className="w-full gap-2" asChild><a href={link.href} target="_blank" rel="noopener noreferrer">Открыть <ExternalLink className="h-4 w-4" /></a></Button></div>)}</div>}
  </section>;
};
