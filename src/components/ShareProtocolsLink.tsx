import { useEffect, useState } from 'react';
import { Copy, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProtocolLink = { id: string; token: string; name: string | null };
const prefix = '[Протоколы] ';
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');

export const ShareProtocolsLink = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [links, setLinks] = useState<ProtocolLink[]>([]);
  const [name, setName] = useState('');
  const url = (value: string) => `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/#/protocols/${encodeURIComponent(value)}`;

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from('shared_transaction_links').select('id, token, name').eq('owner_user_id', user.id).like('name', `${prefix}%`).order('created_at', { ascending: false });
    setLinks((data || []) as ProtocolLink[]);
  };
  useEffect(() => { void load(); }, [user]);

  const create = async () => {
    if (!user) return;
    const { data, error } = await supabase.from('shared_transaction_links').insert({ owner_user_id: user.id, token: token(), name: `${prefix}${name.trim() || 'Создание протоколов'}` }).select('id, token, name').single();
    if (error) { toast({ title: 'Не удалось создать ссылку', description: error.message, variant: 'destructive' }); return; }
    setLinks(current => [data as ProtocolLink, ...current]);
    setName('');
    toast({ title: 'Ссылка на протоколы создана' });
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from('shared_transaction_links').delete().eq('id', id);
    if (error) { toast({ title: 'Не удалось удалить ссылку', description: error.message, variant: 'destructive' }); return; }
    setLinks(current => current.filter(link => link.id !== id));
  };

  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">По этой ссылке можно создать и сохранить PDF-протокол Пресвитерского или Церковного совета.</p>
    <div className="flex gap-2"><Input value={name} onChange={event => setName(event.target.value)} placeholder="Название ссылки (необязательно)" /><Button type="button" size="icon" onClick={() => void create()}><Plus className="h-4 w-4" /></Button></div>
    {links.map(link => <div key={link.id} className="flex items-center gap-2 rounded-lg border bg-secondary/30 p-3"><FileText className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium">{link.name?.replace(prefix, '')}</p><p className="truncate text-xs text-muted-foreground">{url(link.token)}</p></div><Button variant="ghost" size="icon" onClick={() => void navigator.clipboard.writeText(url(link.token))} title="Копировать"><Copy className="h-4 w-4" /></Button><Button variant="ghost" size="icon" asChild title="Открыть"><a href={url(link.token)} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => void remove(link.id)} title="Удалить"><Trash2 className="h-4 w-4" /></Button></div>)}
  </div>;
};
