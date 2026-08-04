import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2, QrCode, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type PublicLinkKind = 'payout' | 'deposit' | 'transactions' | 'analytics';

interface PublicLink {
  id: string;
  token: string;
  name: string | null;
}

const kindLabels: Record<PublicLinkKind, string> = {
  payout: 'Расходный ордер',
  deposit: 'Приходный ордер',
  transactions: 'Таблица транзакций',
  analytics: 'Аналитика',
};

export const PublicLinkHeaderActions = ({ kind }: { kind: PublicLinkKind }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<PublicLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<PublicLink | null>(null);

  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const getUrl = (token: string) => {
    if (kind === 'payout') return `${baseUrl}/payout/${encodeURIComponent(token)}`;
    if (kind === 'deposit') return `${baseUrl}/deposit/${encodeURIComponent(token)}`;
    if (kind === 'analytics') return `${baseUrl}/#/analytics/${encodeURIComponent(token)}`;
    return `${baseUrl}/#/transactions/${encodeURIComponent(token)}`;
  };

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLinks([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      if (kind === 'payout' || kind === 'deposit') {
        let query = supabase
          .from('shared_payout_links')
          .select('id, token, name')
          .eq('owner_user_id', user.id)
          .order('created_at', { ascending: false });
        query = kind === 'deposit'
          ? query.eq('link_type', 'deposit')
          : query.or('link_type.is.null,link_type.neq.deposit');
        const { data } = await query;
        setLinks((data || []) as PublicLink[]);
      } else {
        let query = supabase
          .from('shared_transaction_links')
          .select('id, token, name')
          .eq('owner_user_id', user.id)
          .order('created_at', { ascending: false });
        query = kind === 'analytics'
          ? query.like('name', '[Аналитика]%')
          : query.not('name', 'like', '[Аналитика]%');
        const { data } = await query;
        setLinks((data || []) as PublicLink[]);
      }
      setLoading(false);
    };

    void load();
  }, [kind, user]);

  const copy = async (link: PublicLink) => {
    await navigator.clipboard.writeText(getUrl(link.token));
    setCopiedId(link.id);
    window.setTimeout(() => setCopiedId(null), 1600);
    toast({ title: 'Ссылка скопирована' });
  };

  const remove = async (link: PublicLink) => {
    if (!window.confirm(`Удалить ссылку «${link.name || kindLabels[kind]}»?`)) return;
    const table = kind === 'payout' || kind === 'deposit' ? 'shared_payout_links' : 'shared_transaction_links';
    const { error } = await supabase.from(table).delete().eq('id', link.id);
    if (error) {
      toast({ title: 'Не удалось удалить ссылку', description: error.message, variant: 'destructive' });
      return;
    }
    setLinks(current => current.filter(item => item.id !== link.id));
    toast({ title: 'Ссылка удалена' });
  };

  if (loading) return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
      {links.map(link => (
        <div key={link.id} className="flex items-center gap-0.5 rounded-md border border-border bg-background/40 px-0.5">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void copy(link)} title="Копировать ссылку">
            {copiedId === link.id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setQrLink(link)} title="QR-код">
            <QrCode className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" asChild title="Открыть ссылку">
            <a href={getUrl(link.token)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => void remove(link)} title="Удалить ссылку">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Dialog open={Boolean(qrLink)} onOpenChange={open => !open && setQrLink(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>QR-код ссылки</DialogTitle></DialogHeader>
          {qrLink && <div className="flex justify-center rounded-lg bg-white p-4"><QRCodeSVG value={getUrl(qrLink.token)} size={240} level="H" includeMargin /></div>}
        </DialogContent>
      </Dialog>
    </div>
  );
};
