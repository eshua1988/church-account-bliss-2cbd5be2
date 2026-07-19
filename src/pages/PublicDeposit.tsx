import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Eraser, Loader2, ReceiptText } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { amountInPolishWords, type DepositCurrency } from '@/lib/amountInWords';

const PublicDeposit = () => {
  const { token = '' } = useParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [valid, setValid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [organizationName, setOrganizationName] = useState('ZBÓR BIBLIJNY KOŚCIÓŁ W WARSZAWIE');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    amount: '',
    currency: 'PLN' as DepositCurrency,
    customCurrency: '',
    date: new Date().toISOString().slice(0, 10),
    receivedFrom: '',
    basis: '',
    cashier: '',
  });

  const numericAmount = Number(form.amount.replace(',', '.')) || 0;
  const amountInWords = amountInPolishWords(numericAmount, form.currency, form.customCurrency);

  useEffect(() => {
    supabase.functions.invoke('validate-payout-token', { body: { token } })
      .then(({ data }) => {
        const isDeposit = data?.valid && data?.linkType === 'deposit';
        setValid(Boolean(isDeposit));
        setOrganizationName(data?.organizationName || organizationName);
        if (!isDeposit) setError('Ссылка недействительна или отключена');
      })
      .catch(() => setError('Не удалось проверить ссылку'))
      .finally(() => setLoading(false));
  }, [token]);

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const context = canvasRef.current?.getContext('2d');
    const point = pointerPosition(event);
    context?.beginPath();
    context?.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineTo(point.x, point.y);
    context.stroke();
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const fillAnother = () => {
    setForm({
      amount: '',
      currency: 'PLN',
      customCurrency: '',
      date: new Date().toISOString().slice(0, 10),
      receivedFrom: '',
      basis: '',
      cashier: '',
    });
    setError('');
    setSuccess(false);
    requestAnimationFrame(clearSignature);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const amount = Number(form.amount.replace(',', '.'));
    if (!amount || amount <= 0 || !form.receivedFrom.trim() || !form.basis.trim()) {
      setError('Заполните сумму, получателя и основание');
      return;
    }
    setSubmitting(true);
    const signature = canvasRef.current?.toDataURL('image/png').split(',')[1] || '';
    const { data, error: submitError } = await supabase.functions.invoke('submit-public-deposit', {
      body: { token, ...form, amount, amountInWords, signatureBase64: signature, organizationName },
    });
    setSubmitting(false);
    if (submitError || !data?.success) {
      setError(data?.error || submitError?.message || 'Не удалось отправить документ');
      return;
    }
    setSuccess(true);
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!valid) {
    return <div className="flex min-h-screen items-center justify-center p-4"><Card><CardContent className="p-8 text-destructive">{error}</CardContent></Card></div>;
  }
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md text-center">
          <CardContent className="space-y-3 p-8">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <h1 className="text-xl font-bold">Dowód wpłaty отправлен</h1>
            <p className="text-muted-foreground">Заполненный PDF появился в уведомлениях бухгалтерии.</p>
            <Button className="w-full" onClick={fillAnother}>
              Заполнить ещё один Dowód wpłaty
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background p-3 sm:p-8">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ReceiptText className="h-6 w-6" />Dowód wpłaty</CardTitle>
          <p className="text-sm text-muted-foreground">{organizationName}</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5 sm:grid-cols-2" onSubmit={submit}>
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Kwota / Сумма</Label>
              <div className="grid grid-cols-[1fr_110px] gap-2">
                <Input
                  id="deposit-amount"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={e => {
                    const sanitized = e.target.value.replace(/[^\d.,]/g, '').replace(/([.,].*)[.,]/g, '$1');
                    setForm({ ...form, amount: sanitized });
                  }}
                  required
                />
                <Select value={form.currency} onValueChange={(currency: DepositCurrency) => setForm({ ...form, currency })}>
                  <SelectTrigger aria-label="Валюта"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLN">PLN - zł</SelectItem>
                    <SelectItem value="USD">USD - $</SelectItem>
                    <SelectItem value="EUR">EUR - €</SelectItem>
                    <SelectItem value="UAH">UAH - ₴</SelectItem>
                    <SelectItem value="OTHER">Другая</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.currency === 'OTHER' && (
                <Input
                  aria-label="Название другой валюты"
                  placeholder="Название или код валюты"
                  value={form.customCurrency}
                  onChange={e => setForm({ ...form, customCurrency: e.target.value.slice(0, 20) })}
                  required
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="deposit-date">Data / Дата</Label>
              <Input id="deposit-date" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deposit-from">Otrzymano od / Получено от</Label>
              <Input id="deposit-from" value={form.receivedFrom} onChange={e => setForm({ ...form, receivedFrom: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deposit-basis">Podstawa / Основание</Label>
              <Textarea id="deposit-basis" value={form.basis} onChange={e => setForm({ ...form, basis: e.target.value })} required />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deposit-words">Kwota słownie / Сумма прописью</Label>
              <Textarea id="deposit-words" value={amountInWords} readOnly className="cursor-default bg-muted" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="deposit-cashier">Kasjer / Кассир</Label>
              <Input id="deposit-cashier" value={form.cashier} onChange={e => setForm({ ...form, cashier: e.target.value })} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Podpis nadawcy / Подпись отправителя</Label>
                <Button type="button" variant="ghost" size="sm" onClick={clearSignature}><Eraser className="mr-1 h-4 w-4" />Очистить</Button>
              </div>
              <canvas
                ref={canvasRef}
                width={900}
                height={220}
                className="h-40 w-full touch-none rounded-md border bg-white"
                onPointerDown={startDrawing}
                onPointerMove={draw}
                onPointerUp={() => { drawing.current = false; }}
                onPointerCancel={() => { drawing.current = false; }}
              />
            </div>
            {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
            <Button className="h-12 sm:col-span-2" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Заполнить PDF и отправить
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export default PublicDeposit;
