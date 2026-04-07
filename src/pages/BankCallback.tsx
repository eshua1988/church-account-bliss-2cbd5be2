import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function BankCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Обработка авторизации банка...');
  const [imported, setImported] = useState(0);
  const [bankName, setBankName] = useState('');

  useEffect(() => {
    const error = searchParams.get('error');
    const ref = searchParams.get('ref');

    // GoCardless: ref = reference we set (JSON with user_id, bank_name)
    // requisition_id stored in localStorage before redirect
    let decodedBankName = '';
    let stateUserId = '';
    if (ref) {
      try {
        const parsed = JSON.parse(ref);
        decodedBankName = parsed.bank_name || '';
        stateUserId = parsed.user_id || '';
      } catch {
        stateUserId = ref;
      }
    }
    setBankName(decodedBankName || 'Банк');

    // Get requisition_id from localStorage
    const requisitionId = localStorage.getItem('gc_requisition_id') || '';
    localStorage.removeItem('gc_requisition_id');

    if (error) {
      setStatus('error');
      setMessage('Авторизация отклонена: ' + (searchParams.get('error_description') || error));
      return;
    }
    if (!requisitionId) {
      setStatus('error');
      setMessage('requisition_id не найден. Попробуйте подключить банк заново.');
      return;
    }

    completeAuth(requisitionId, decodedBankName, stateUserId);
  }, []);

  async function completeAuth(requisitionId: string, resolvedBankName: string, fallbackUserId: string) {
    try {
      setMessage('Получение данных из банка...');
      const supabaseUrl = (supabase as any).supabaseUrl as string;
      const supabaseKey = (supabase as any).supabaseKey as string;

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || supabaseKey;
      const userId = session?.user?.id || fallbackUserId;
      console.log('[BankCallback] userId:', userId, 'bank:', resolvedBankName, 'requisitionId:', requisitionId);

      const res = await fetch(`${supabaseUrl}/functions/v1/banking-auth-complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ requisition_id: requisitionId, user_id: userId, bank_name: resolvedBankName }),
      });

      const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      console.log('[BankCallback] response:', res.status, json);

      if (!res.ok) {
        setStatus('error');
        setMessage(json?.error || `HTTP ${res.status}`);
        return;
      }

      setImported(json.imported || 0);
      setStatus('success');
      const detail = json.total != null ? ` (найдено в банке: ${json.total})` : '';
      setMessage(`Импортировано транзакций: ${json.imported || 0}${detail}`);
      if (json.debug) console.log('[BankCallback] debug:', json.debug);
      toast({ title: `${resolvedBankName || 'Банк'} подключён`, description: `Импортировано ${json.imported || 0} транзакций${detail}` });
    } catch (e) {
      setStatus('error');
      setMessage(String(e));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-auto p-8 bg-card border border-border rounded-2xl shadow-lg text-center space-y-6">
        <div className="flex justify-center">
          {status === 'loading' && <Loader2 className="h-12 w-12 text-primary animate-spin" />}
          {status === 'success' && <CheckCircle2 className="h-12 w-12 text-green-500" />}
          {status === 'error'   && <AlertCircle  className="h-12 w-12 text-destructive" />}
        </div>
        <div>
          <h1 className="text-xl font-bold mb-2">
            {status === 'loading' ? `Подключение ${bankName}...` :
             status === 'success' ? `${bankName} подключён!` :
             'Ошибка подключения'}
          </h1>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
        {status !== 'loading' && (
          <Button onClick={() => navigate('/')} className="w-full">
            Перейти в приложение
          </Button>
        )}
      </div>
    </div>
  );
}
