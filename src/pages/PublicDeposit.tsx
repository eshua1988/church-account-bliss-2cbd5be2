import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Eraser, Loader2, Plus, ReceiptText, Trash2, UserRoundPlus } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { type DepositCurrency } from '@/lib/amountInWords';

interface IncomeCategory {
  id: string;
  name: string;
  type: 'income';
}

interface DepositSigner {
  id: string;
  fullName: string;
}

interface DepositEntry {
  id: string;
  amount: string;
  currency: DepositCurrency;
  customCurrency: string;
  date: string;
  basisChoice: string;
  customBasis: string;
  basisDetails: string;
  signers: DepositSigner[];
}

const OTHER_BASIS = '__other__';
const createSigner = (): DepositSigner => ({ id: crypto.randomUUID(), fullName: '' });
const createEntry = (): DepositEntry => ({
  id: crypto.randomUUID(),
  amount: '',
  currency: 'PLN',
  customCurrency: '',
  date: new Date().toISOString().slice(0, 10),
  basisChoice: '',
  customBasis: '',
  basisDetails: '',
  signers: [createSigner()],
});

const PublicDeposit = () => {
  const { token = '' } = useParams();
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const drawingId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [valid, setValid] = useState(false);
  const [success, setSuccess] = useState(false);
  const [organizationName, setOrganizationName] = useState('ZBÓR BIBLIJNY KOŚCIÓŁ W WARSZAWIE');
  const [incomeCategories, setIncomeCategories] = useState<IncomeCategory[]>([]);
  const [entries, setEntries] = useState<DepositEntry[]>([createEntry()]);
  const signedSignerIds = useRef(new Set<string>());
  const [error, setError] = useState('');

  useEffect(() => {
    const depositPath = `/deposit/${token}`;
    localStorage.setItem('pwa:last-public-deposit', depositPath);
    document.cookie = `pwa_last_public_deposit=${encodeURIComponent(depositPath)}; Path=${import.meta.env.BASE_URL}; Max-Age=31536000; SameSite=Lax; Secure`;

    let manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const previousManifestHref = manifestLink?.getAttribute('href') || '';
    const previousTitle = document.title;
    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const previousAppleTitle = appleTitle?.content || '';

    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = `${import.meta.env.BASE_URL}deposit-manifest.webmanifest`;
    document.title = 'Dowód wpłaty';
    if (appleTitle) appleTitle.content = 'Dowód wpłaty';

    supabase.functions.invoke('validate-payout-token', { body: { token } })
      .then(({ data }) => {
        const isDeposit = data?.valid && data?.linkType === 'deposit';
        setValid(Boolean(isDeposit));
        setOrganizationName(data?.organizationName || organizationName);
        setIncomeCategories(
          Array.isArray(data?.categories)
            ? data.categories.filter((category: IncomeCategory) => category?.type === 'income' && category?.name)
            : [],
        );
        if (!isDeposit) setError('Ссылка недействительна или отключена');
      })
      .catch(() => setError('Не удалось проверить ссылку'))
      .finally(() => setLoading(false));

    return () => {
      if (previousManifestHref) manifestLink!.href = previousManifestHref;
      else manifestLink?.remove();
      document.title = previousTitle;
      if (appleTitle) appleTitle.content = previousAppleTitle;
    };
  }, [token]);

  const updateEntry = (id: string, patch: Partial<DepositEntry>) => {
    setEntries(current => current.map(entry => entry.id === id ? { ...entry, ...patch } : entry));
  };

  const updateSigner = (entryId: string, signerId: string, fullName: string) => {
    setEntries(current => current.map(entry => entry.id === entryId
      ? { ...entry, signers: entry.signers.map(signer => signer.id === signerId ? { ...signer, fullName } : signer) }
      : entry));
  };

  const addSigner = (entryId: string) => {
    setEntries(current => current.map(entry => entry.id === entryId
      ? { ...entry, signers: [...entry.signers, createSigner()] }
      : entry));
  };

  const removeSigner = (entryId: string, signerId: string) => {
    delete canvasRefs.current[signerId];
    signedSignerIds.current.delete(signerId);
    setEntries(current => current.map(entry => entry.id === entryId && entry.signers.length > 1
      ? { ...entry, signers: entry.signers.filter(signer => signer.id !== signerId) }
      : entry));
  };

  const isTargetedCategory = (entry: DepositEntry) => {
    const name = incomeCategories.find(category => category.id === entry.basisChoice)?.name || '';
    return /(целев|ціль|celow)/i.test(name);
  };

  const pointerPosition = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * canvas.width / rect.width,
      y: (event.clientY - rect.top) * canvas.height / rect.height,
    };
  };

  const startDrawing = (id: string, event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingId.current = id;
    const context = event.currentTarget.getContext('2d');
    const point = pointerPosition(event);
    context?.beginPath();
    context?.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const draw = (id: string, event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingId.current !== id) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.strokeStyle = '#111827';
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineTo(point.x, point.y);
    context.stroke();
    signedSignerIds.current.add(id);
  };

  const clearSignature = (id: string) => {
    const canvas = canvasRefs.current[id];
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    signedSignerIds.current.delete(id);
  };

  const fillAnother = () => {
    canvasRefs.current = {};
    signedSignerIds.current.clear();
    setEntries([createEntry()]);
    setError('');
    setSuccess(false);
  };

  const addEntry = () => {
    setEntries(current => [...current, createEntry()]);
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  };

  const removeEntry = (id: string) => {
    if (entries.length === 1) return;
    const signerIds = entries.find(entry => entry.id === id)?.signers.map(signer => signer.id) || [];
    signerIds.forEach(signerId => delete canvasRefs.current[signerId]);
    signerIds.forEach(signerId => signedSignerIds.current.delete(signerId));
    setEntries(current => current.filter(entry => entry.id !== id));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const preparedEntries = entries.map(entry => {
      const selectedCategory = incomeCategories.find(category => category.id === entry.basisChoice);
      const basis = entry.basisChoice === OTHER_BASIS
        ? entry.customBasis.trim()
        : [selectedCategory?.name.trim(), isTargetedCategory(entry) ? entry.basisDetails.trim() : ''].filter(Boolean).join(': ');
      const signers = entry.signers.map(signer => ({
        fullName: signer.fullName.trim(),
        signatureBase64: signedSignerIds.current.has(signer.id)
          ? canvasRefs.current[signer.id]?.toDataURL('image/png').split(',')[1] || ''
          : '',
      }));
      return {
        amount: Number(entry.amount.replace(',', '.')),
        currency: entry.currency,
        customCurrency: entry.customCurrency,
        date: entry.date,
        basis,
        signers,
        // Legacy fields keep older deployed functions compatible during rollout.
        receivedFrom: signers[0]?.fullName || '',
        signatureBase64: signers[0]?.signatureBase64 || '',
      };
    });
    const invalid = preparedEntries.some(entry =>
      !entry.amount || entry.amount <= 0 || !entry.date || !entry.basis ||
      entry.signers.length === 0 || entry.signers.some(signer => !signer.fullName || !signer.signatureBase64) ||
      (entry.currency === 'OTHER' && !entry.customCurrency.trim()),
    );
    if (invalid) {
      setError('Заполните сумму, дату, основание, имя и обязательную подпись каждого отправителя');
      return;
    }
    setSubmitting(true);
    const { data, error: submitError } = await supabase.functions.invoke('submit-public-deposit', {
      body: { token, entries: preparedEntries, organizationName },
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
            <p className="text-muted-foreground">Все квитанции сохранены в одном PDF в уведомлениях бухгалтерии.</p>
            <Button className="w-full" onClick={fillAnother}>Заполнить новый Dowód wpłaty</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background px-1.5 py-3 sm:p-8">
      <Card className="mx-auto w-full max-w-2xl overflow-hidden">
        <CardHeader className="px-3 py-5 sm:px-6 sm:py-6">
          <CardTitle className="flex items-center gap-2"><ReceiptText className="h-6 w-6" />Dowód wpłaty</CardTitle>
          <p className="text-sm text-muted-foreground">{organizationName}</p>
        </CardHeader>
        <CardContent className="px-2 pb-4 sm:px-6 sm:pb-6">
          <form className="min-w-0 space-y-4 sm:space-y-6" onSubmit={submit}>
            {entries.map((entry, index) => (
              <section key={entry.id} className="grid min-w-0 gap-4 rounded-lg border px-2.5 py-4 sm:grid-cols-2 sm:gap-5 sm:p-4">
                <div className="flex items-center justify-between sm:col-span-2">
                  <h2 className="font-semibold">Dowód wpłaty {index + 1}</h2>
                  {entries.length > 1 && (
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeEntry(entry.id)} aria-label="Удалить квитанцию">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`amount-${entry.id}`}>Kwota / Сумма</Label>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_96px] gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
                    <Input
                      id={`amount-${entry.id}`}
                      inputMode="decimal"
                      value={entry.amount}
                      onChange={event => updateEntry(entry.id, {
                        amount: event.target.value.replace(/[^\d.,]/g, '').replace(/([.,].*)[.,]/g, '$1'),
                      })}
                      required
                    />
                    <Select value={entry.currency} onValueChange={(currency: DepositCurrency) => updateEntry(entry.id, { currency })}>
                      <SelectTrigger aria-label="Валюта"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PLN">PLN</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="UAH">UAH</SelectItem>
                        <SelectItem value="OTHER">Другая</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {entry.currency === 'OTHER' && (
                    <Input
                      aria-label="Название другой валюты"
                      placeholder="Название или код валюты"
                      value={entry.customCurrency}
                      onChange={event => updateEntry(entry.id, { customCurrency: event.target.value.slice(0, 20) })}
                      required
                    />
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`date-${entry.id}`}>Data / Дата</Label>
                  <Input className="block min-w-0 max-w-full" id={`date-${entry.id}`} type="date" value={entry.date} onChange={event => updateEntry(entry.id, { date: event.target.value })} required />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Podstawa / Основание</Label>
                  <RadioGroup
                    value={entry.basisChoice}
                    onValueChange={basisChoice => updateEntry(entry.id, {
                      basisChoice,
                      customBasis: basisChoice === OTHER_BASIS ? entry.customBasis : '',
                      basisDetails: /(целев|ціль|celow)/i.test(incomeCategories.find(category => category.id === basisChoice)?.name || '')
                        ? entry.basisDetails
                        : '',
                    })}
                    className="gap-0 overflow-hidden rounded-md border"
                  >
                    {incomeCategories.map(category => (
                      <Label key={category.id} htmlFor={`basis-${entry.id}-${category.id}`} className="flex cursor-pointer items-center gap-3 border-b px-4 py-3 font-normal hover:bg-muted/50">
                        <RadioGroupItem id={`basis-${entry.id}-${category.id}`} value={category.id} />
                        <span>{category.name}</span>
                      </Label>
                    ))}
                    <Label htmlFor={`basis-${entry.id}-other`} className="flex cursor-pointer items-center gap-3 px-4 py-3 font-normal hover:bg-muted/50">
                      <RadioGroupItem id={`basis-${entry.id}-other`} value={OTHER_BASIS} />
                      <span>Другое</span>
                    </Label>
                  </RadioGroup>
                  {entry.basisChoice === OTHER_BASIS && (
                    <Textarea
                      value={entry.customBasis}
                      onChange={event => updateEntry(entry.id, { customBasis: event.target.value })}
                      placeholder="Введите основание"
                      required
                    />
                  )}
                  {isTargetedCategory(entry) && (
                    <Textarea
                      value={entry.basisDetails}
                      onChange={event => updateEntry(entry.id, { basisDetails: event.target.value })}
                      placeholder="Уточните назначение целевого пожертвования"
                    />
                  )}
                </div>
                {entry.signers.map((signer, signerIndex) => (
                  <div key={signer.id} className="min-w-0 space-y-3 rounded-md border p-2.5 sm:col-span-2 sm:p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label className="font-semibold">Nadawca {signerIndex + 1} / Отправитель {signerIndex + 1}</Label>
                      {entry.signers.length > 1 && (
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeSigner(entry.id, signer.id)} aria-label="Удалить отправителя">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`from-${signer.id}`}>Imię i nazwisko / Имя Фамилия</Label>
                      <Input id={`from-${signer.id}`} value={signer.fullName} onChange={event => updateSigner(entry.id, signer.id, event.target.value)} required />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Podpis / Подпись</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={() => clearSignature(signer.id)}><Eraser className="mr-1 h-4 w-4" />Очистить</Button>
                    </div>
                    <canvas
                      ref={canvas => { canvasRefs.current[signer.id] = canvas; }}
                      width={900}
                      height={220}
                      className="h-40 w-full touch-none rounded-md border bg-white"
                      onPointerDown={event => startDrawing(signer.id, event)}
                      onPointerMove={event => draw(signer.id, event)}
                      onPointerUp={() => { drawingId.current = null; }}
                      onPointerCancel={() => { drawingId.current = null; }}
                    />
                  </div>
                ))}
                <Button type="button" variant="outline" className="sm:col-span-2" onClick={() => addSigner(entry.id)} disabled={entry.signers.length >= 10}>
                  <UserRoundPlus className="mr-2 h-5 w-5" />Добавить дополнительного пользователя
                </Button>
              </section>
            ))}
            <Button type="button" variant="outline" className="h-12 w-full" onClick={addEntry}>
              <Plus className="mr-2 h-4 w-4" />Добавить Dowód wpłaty
            </Button>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="h-12 w-full" disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сформировать и отправить PDF
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
};

export default PublicDeposit;
