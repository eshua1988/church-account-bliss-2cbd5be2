import { useState, useEffect } from 'react';
import { Link2, QrCode, Copy, Check, Trash2, Plus, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { QRCodeSVG } from 'qrcode.react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface SharedLink {
  id: string;
  token: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
  expires_at: string | null;
}

const generateToken = () => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => 
    byte.toString(16).padStart(2, '0')
  ).join('');
};

export const SharePayoutLink = () => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [links, setLinks] = useState<SharedLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [newLinkName, setNewLinkName] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<SharedLink | null>(null);
  const [showQrDialog, setShowQrDialog] = useState(false);

  const baseUrl = window.location.origin;

  useEffect(() => {
    if (user) {
      fetchLinks();
    }
  }, [user]);

  const fetchLinks = async () => {
    if (!user) return;
    
    try {
      const { data, error } = await supabase
        .from('shared_payout_links')
        .select('*')
        .eq('owner_user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setLinks(data || []);
    } catch (err) {
      console.error('Error fetching links:', err);
    } finally {
      setLoading(false);
    }
  };

  const createLink = async () => {
    if (!user) return;

    try {
      const token = generateToken();
      const { data, error } = await supabase
        .from('shared_payout_links')
        .insert({
          owner_user_id: user.id,
          token,
          name: newLinkName || null,
        })
        .select()
        .single();

      if (error) throw error;
      
      setLinks(prev => [data, ...prev]);
      setNewLinkName('');
      
      toast({
        title: 'Link utworzony',
        description: 'Nowy link został utworzony',
      });
    } catch (err) {
      console.error('Error creating link:', err);
      toast({
        title: 'Błąd',
        description: 'Nie udało się utworzyć linku',
        variant: 'destructive',
      });
    }
  };

  const deleteLink = async (id: string) => {
    try {
      const { error } = await supabase
        .from('shared_payout_links')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      setLinks(prev => prev.filter(l => l.id !== id));
      
      toast({
        title: 'Link usunięty',
        description: 'Link został usunięty',
      });
    } catch (err) {
      console.error('Error deleting link:', err);
    }
  };

  const copyLink = async (link: SharedLink) => {
    const url = `${baseUrl}/payout/${link.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
    
    toast({
      title: 'Skopiowano',
      description: 'Link został skopiowany do schowka',
    });
  };

  const openQrDialog = (link: SharedLink) => {
    setSelectedLink(link);
    setShowQrDialog(true);
  };

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Link2 className="w-5 h-5" />
          Udostępnij formularz
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new link */}
        <div className="flex gap-2">
          <Input
            placeholder="Nazwa linku (opcjonalna)"
            value={newLinkName}
            onChange={(e) => setNewLinkName(e.target.value)}
            className="flex-1"
          />
          <Button onClick={createLink} size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {/* Links list */}
        <div className="space-y-2">
          {links.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Brak utworzonych linków. Utwórz pierwszy link powyżej.
            </p>
          )}
          
          {links.map((link) => (
            <div
              key={link.id}
              className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">
                  {link.name || 'Link bez nazwy'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {baseUrl}/payout/{link.token}
                </p>
              </div>
              
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyLink(link)}
                  title="Kopiuj link"
                >
                  {copiedId === link.id ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openQrDialog(link)}
                  title="Pokaż QR kod"
                >
                  <QrCode className="w-4 h-4" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open(`${baseUrl}/payout/${link.token}`, '_blank')}
                  title="Otwórz w nowej karcie"
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
                
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteLink(link.id)}
                  title="Usuń link"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* QR Code Dialog */}
        <Dialog open={showQrDialog} onOpenChange={setShowQrDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>QR kod</DialogTitle>
            </DialogHeader>
            {selectedLink && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="p-4 bg-white rounded-lg">
                  <QRCodeSVG
                    value={`${baseUrl}/payout/${selectedLink.token}`}
                    size={256}
                    level="H"
                    includeMargin
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  {selectedLink.name || 'Link bez nazwy'}
                </p>
                <p className="text-xs text-muted-foreground break-all text-center">
                  {baseUrl}/payout/{selectedLink.token}
                </p>
                <Button
                  onClick={() => copyLink(selectedLink)}
                  variant="outline"
                  className="w-full"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Kopiuj link
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};