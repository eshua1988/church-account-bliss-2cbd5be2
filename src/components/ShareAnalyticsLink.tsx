import { useEffect, useState } from 'react';
import { BarChart3, Copy, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface AnalyticsLink {
  id: string;
  token: string;
  name: string | null;
}

const generateToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};

export const ShareAnalyticsLink = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<AnalyticsLink[]>([]);
  const [name, setName] = useState('');
  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = (token: string) => `${baseUrl}/#/analytics/${encodeURIComponent(token)}`;

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('shared_transaction_links')
      .select('id, token, name')
      .eq('owner_user_id', user.id)
      .like('name', '[Аналитика]%')
      .order('created_at', { ascending: false });
    setLinks(data || []);
  };

  useEffect(() => { void load(); }, [user]);

  const create = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('shared_transaction_links').insert({
      owner_user_id: user.id,
      token: generateToken(),
      name: `[Аналитика] ${name.trim() || 'Общий отчёт'}`,
    }).select('id, token, name').single();
    if (error) {
      toast({ title: 'Не удалось создать ссылку', description: error.message, variant: 'destructive' });
      return;
    }
    setLinks(current => [data, ...current]);
    setName('');
    toast({ title: 'Ссылка на аналитику создана' });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from('shared_transaction_links').delete().eq('id', id);
    if (!error) setLinks(current => current.filter(link => link.id !== id));
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Публичная аналитика</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input value={name} onChange={event => setName(event.target.value)} placeholder="Название ссылки (необязательно)" />
          <Button type="button" size="icon" onClick={create}><Plus className="h-4 w-4" /></Button>
        </div>
        {links.map(link => (
          <div key={link.id} className="flex items-center gap-2 rounded-lg border bg-secondary/30 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{link.name?.replace('[Аналитика] ', '')}</p>
              <p className="truncate text-xs text-muted-foreground">{url(link.token)}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => navigator.clipboard.writeText(url(link.token))}><Copy className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" asChild><a href={url(link.token)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => remove(link.id)}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
