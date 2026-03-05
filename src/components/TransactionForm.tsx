import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Currency, TransactionType, Transaction } from '@/types/transaction';
import { Category } from '@/hooks/useSupabaseCategories';
import { PlusCircle, MinusCircle, Copy, Check, ExternalLink, ListOrdered, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface PayoutLink {
  id: string;
  token: string;
  name: string | null;
  link_type: 'standard' | 'stepwise';
  is_active: boolean;
}

interface TransactionFormProps {
  onSubmit: (transaction: Omit<Transaction, 'id' | 'createdAt'>) => void;
  incomeCategories: Category[];
  expenseCategories: Category[];
  departments?: string[];
}

export const TransactionForm = ({
  onSubmit,
  incomeCategories,
}: TransactionFormProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [type, setType] = useState<TransactionType>('income');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('PLN');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  // Payout links for expense tab
  const [payoutLinks, setPayoutLinks] = useState<PayoutLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const baseUrl = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');

  // Reset category when type changes
  useEffect(() => {
    if (incomeCategories.length > 0 && !incomeCategories.find(c => c.id === categoryId)) {
      setCategoryId(incomeCategories[0].id);
    }
  }, [incomeCategories, categoryId]);

  // Load active payout links when expense tab selected
  useEffect(() => {
    if (type !== 'expense' || !user) return;
    setLinksLoading(true);
    supabase
      .from('shared_payout_links')
      .select('id, token, name, link_type, is_active')
      .eq('owner_user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setPayoutLinks((data || []) as PayoutLink[]);
        setLinksLoading(false);
      });
  }, [type, user]);

  const handleCopy = (token: string, id: string) => {
    navigator.clipboard.writeText(`${baseUrl}/payout/${token}`).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0 || !categoryId) return;
    onSubmit({
      type,
      amount: parseFloat(amount),
      currency,
      category: categoryId as any,
      description,
      date: new Date(date),
    });
    setAmount('');
    setDescription('');
    setDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Toggle */}
      <div className="flex gap-2 p-1 bg-secondary rounded-lg">
        <button
          type="button"
          onClick={() => setType('income')}
          className={cn('flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200',
            type === 'income' ? 'bg-success text-success-foreground shadow-md' : 'text-muted-foreground hover:text-foreground')}
        >
          <PlusCircle className="w-5 h-5" />
          {t('incomeType')}
        </button>
        <button
          type="button"
          onClick={() => setType('expense')}
          className={cn('flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md font-semibold transition-all duration-200',
            type === 'expense' ? 'bg-destructive text-destructive-foreground shadow-md' : 'text-muted-foreground hover:text-foreground')}
        >
          <MinusCircle className="w-5 h-5" />
          {t('expense')}
        </button>
      </div>

      {/* EXPENSE — payout links */}
      {type === 'expense' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ListOrdered className="w-4 h-4 text-primary" />
            <p className="text-sm font-medium text-foreground">Пошаговый расходный ордер</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Отправьте ссылку получателю или откройте её самостоятельно для заполнения ордера.
          </p>

          {linksLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : payoutLinks.length === 0 ? (
            <div className="rounded-lg border border-border bg-muted/30 p-5 text-center space-y-1">
              <p className="text-sm text-muted-foreground">Нет активных ссылок.</p>
              <p className="text-xs text-muted-foreground">
                Создайте ссылку в разделе <span className="text-primary font-medium">Настройки → Ссылки для выплат</span>.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {payoutLinks.map(link => (
                <div
                  key={link.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {link.name || 'Без названия'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {baseUrl}/payout/{link.token.slice(0, 14)}…
                    </p>
                    {link.link_type === 'stepwise' && (
                      <span className="inline-block mt-1 text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5">
                        Пошаговый
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Копировать ссылку"
                      onClick={() => handleCopy(link.token, link.id)}
                    >
                      {copiedId === link.id
                        ? <Check className="w-4 h-4 text-success" />
                        : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title="Открыть форму"
                      onClick={() => window.open(`${baseUrl}/payout/${link.token}`, '_blank')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* INCOME — full form */
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">{t('amount')}</Label>
              <Input id="amount" type="number" step="0.01" min="0" placeholder="0.00"
                value={amount} onChange={e => setAmount(e.target.value)}
                className="text-lg font-semibold" required />
            </div>
            <div className="space-y-2">
              <Label>{t('currency')}</Label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('category')}</Label>
            {incomeCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">{t('noCategoriesWarning')}</p>
            ) : (
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger><SelectValue placeholder={t('selectCategory')} /></SelectTrigger>
                <SelectContent>
                  {incomeCategories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="date">{t('date')}</Label>
            <Input id="date" type="date" value={date} onChange={e => setDate(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('description')}</Label>
            <Textarea id="description" placeholder={t('addDescription')}
              value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>

          <Button
            type="submit"
            disabled={incomeCategories.length === 0}
            className="w-full py-6 text-lg font-semibold bg-success hover:bg-success/90"
          >
            {t('addIncome')}
          </Button>
        </form>
      )}
    </div>
  );
};
