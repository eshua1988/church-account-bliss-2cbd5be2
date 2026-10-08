import { useEffect, useState } from 'react';
import { ExternalLink, Link as LinkIcon, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

type LinkItem = { id: string; token: string; name: string | null; kind: 'payout' | 'deposit' | 'transactions' | 'analytics' };

const labels: Record<LinkItem['kind'], string> = {
  payout: 'Расходные ордера',
  deposit: 'Приходные ордера',
  transactions: 'Таблицы транзакций',
  analytics: 'Аналитика',
};

export const LinksPage = () => {
  const { user } = useAuth();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const [payouts, transactions] = await Promise.all([
        supabase.from('shared_payout_links').select('id, token, name, link_type').eq('owner_user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('shared_transaction_links').select('id, token, name').eq('owner_user_id', user.id).order('created_at', { ascending: false }),
      ]);
      const payoutLinks = (payouts.data || []).map((link: any): LinkItem => ({
        id: link.id, token: link.token, name: link.name, kind: link.link_type === 'deposit' ? 'deposit' : 'payout',
      }));
      const transactionLinks = (transactions.data || []).map((link: any): LinkItem => ({
        id: link.id, token: link.token, name: link.name, kind: link.name?.startsWith('[Аналитика]') ? 'analytics' : 'transactions',
      }));
      setLinks([...payoutLinks, ...transactionLinks]);
      setLoading(false);
    };
    void load();
  }, [user]);

  const url = (link: LinkItem) => {
    const base = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`;
    if (link.kind === 'payout') return `${base}/payout/${encodeURIComponent(link.token)}`;
    if (link.kind === 'deposit') return `${base}/deposit/${encodeURIComponent(link.token)}`;
    return `${base}/#/${link.kind}/${encodeURIComponent(link.token)}`;
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>;
  return <section className="animate-fade-in mx-auto max-w-3xl space-y-5"><div><h1 className="text-2xl font-bold">Ссылки</h1><p className="text-muted-foreground">Открывайте нужную публичную форму или страницу из одного места.</p></div>{links.length === 0 ? <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">Публичных ссылок пока нет. Создайте их в настройках.</div> : <div className="grid gap-3 sm:grid-cols-2">{links.map(link => <div key={link.id} className="rounded-xl border bg-card p-4"><div className="mb-4 flex items-start gap-3"><LinkIcon className="mt-0.5 h-5 w-5 text-primary" /><div><p className="font-semibold">{link.name?.replace(/^\[Аналитика\]\s*/, '') || labels[link.kind]}</p><p className="text-sm text-muted-foreground">{labels[link.kind]}</p></div></div><Button className="w-full gap-2" asChild><a href={url(link)} target="_blank" rel="noopener noreferrer">Открыть <ExternalLink className="h-4 w-4" /></a></Button></div>)}</div>}</section>;
};
