import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, FilePenLine, Plus, QrCode, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { loadHeaderSettings } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface DepositLink {
  id: string;
  token: string;
  name: string | null;
}

const generateToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

export const ShareDepositLink = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<DepositLink[]>([]);
  const [name, setName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState<DepositLink | null>(null);
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const linkUrl = (link: DepositLink) => `${baseUrl}/deposit/${link.token}`;

  const fetchLinks = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('shared_payout_links')
      .select('id, token, name')
      .eq('owner_user_id', user.id)
      .eq('link_type', 'deposit')
      .order('created_at', { ascending: false });
    setLinks(data || []);
  };

  useEffect(() => {
    fetchLinks();
  }, [user]);

  const createLink = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from('shared_payout_links')
      .insert({
        owner_user_id: user.id,
        token: generateToken(),
        name: name.trim() || 'Dowód wpłaty',
        link_type: 'deposit',
        organization_name: loadHeaderSettings()?.subtitle || null,
      })
      .select('id, token, name')
      .single();
    if (error) {
      toast({ title: 'Не удалось создать ссылку', description: error.message, variant: 'destructive' });
      return;
    }
    setLinks(previous => [data, ...previous]);
    setName('');
    toast({ title: 'Ссылка для Dowód wpłaty создана' });
  };

  const deleteLink = async (id: string) => {
    const { error } = await supabase.from('shared_payout_links').delete().eq('id', id);
    if (!error) setLinks(previous => previous.filter(link => link.id !== id));
  };

  const copyLink = async (link: DepositLink) => {
    await navigator.clipboard.writeText(linkUrl(link));
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FilePenLine className="h-5 w-5" />
          Ссылка для Dowód wpłaty
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="Название ссылки (необязательно)"
          />
          <Button size="icon" onClick={createLink} aria-label="Создать ссылку">
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          {links.map(link => (
            <div key={link.id} className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{link.name || 'Dowód wpłaty'}</p>
                  <Badge variant="secondary">Wpłata</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">{linkUrl(link)}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => copyLink(link)}>
                {copiedId === link.id ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setQrLink(link)}>
                <QrCode className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => window.open(linkUrl(link), '_blank')}>
                <ExternalLink className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={() => deleteLink(link.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {links.length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">Ссылки ещё не созданы</p>
          )}
        </div>
      </CardContent>

      <Dialog open={Boolean(qrLink)} onOpenChange={open => !open && setQrLink(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>QR-код формы</DialogTitle></DialogHeader>
          {qrLink && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-lg bg-white p-3">
                <QRCodeSVG value={linkUrl(qrLink)} size={240} level="H" includeMargin />
              </div>
              <Button variant="outline" className="w-full" onClick={() => copyLink(qrLink)}>
                <Copy className="mr-2 h-4 w-4" />Копировать ссылку
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
};
