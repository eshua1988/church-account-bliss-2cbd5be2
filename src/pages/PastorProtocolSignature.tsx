import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, PenLine } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

const base64 = (bytes: Uint8Array) => {
  let value = '';
  for (let index = 0; index < bytes.length; index += 0x8000) value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(value);
};

export default function PastorProtocolSignature() {
  const { token = '', signToken = '' } = useParams();
  const canvasRef = useRef<HTMLCanvasElement>(null); const drawing = useRef(false);
  const [document, setDocument] = useState<any>(null); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [hasSignature, setHasSignature] = useState(false); const [message, setMessage] = useState('');
  const invoke = useCallback(async (action: string, extra = {}) => {
    const { data, error } = await supabase.functions.invoke('public-protocols', { body: { token, action, sign_token: signToken, ...extra } });
    if (error || data?.error) throw new Error(data?.error || error.message);
    return data;
  }, [token, signToken]);
  useEffect(() => { void (async () => { try { const data = await invoke('load-signing'); setDocument(data.document); } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось открыть ссылку'); } finally { setLoading(false); } })(); }, [invoke]);
  const position = (event: React.PointerEvent<HTMLCanvasElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: (event.clientX - rect.left) * (event.currentTarget.width / rect.width), y: (event.clientY - rect.top) * (event.currentTarget.height / rect.height) }; };
  const start = (event: React.PointerEvent<HTMLCanvasElement>) => { const canvas = canvasRef.current; if (!canvas) return; drawing.current = true; canvas.setPointerCapture(event.pointerId); const point = position(event); const context = canvas.getContext('2d')!; context.beginPath(); context.moveTo(point.x, point.y); };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => { if (!drawing.current) return; const canvas = canvasRef.current; if (!canvas) return; const point = position(event); const context = canvas.getContext('2d')!; context.lineWidth = 3; context.lineCap = 'round'; context.strokeStyle = '#111827'; context.lineTo(point.x, point.y); context.stroke(); setHasSignature(true); };
  const clear = () => { const canvas = canvasRef.current; if (!canvas) return; canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); setHasSignature(false); };
  const sign = async () => { if (!canvasRef.current || !document?.pdf_url || !hasSignature) return; setSaving(true); setMessage(''); try {
    const response = await fetch(document.pdf_url); if (!response.ok) throw new Error('Не удалось загрузить PDF');
    const { PDFDocument } = await import('pdf-lib'); const pdf = await PDFDocument.load(await response.arrayBuffer());
    const signature = canvasRef.current.toDataURL('image/png'); const image = await pdf.embedPng(signature); const page = pdf.getPages().at(-1)!; const scale = Math.min(145 / image.width, 52 / image.height);
    // Matches the pastor signature block in the generated protocol PDF.
    page.drawImage(image, { x: 313.64, y: 89, width: image.width * scale, height: image.height * scale });
    const bytes = await pdf.save(); await invoke('sign', { pastor_signature: signature, pdf_base64: base64(bytes) });
    setDocument((value: any) => ({ ...value, pastor_signed_at: new Date().toISOString() })); setMessage('Протокол подписан. Эта ссылка больше не действует.');
  } catch (error) { setMessage(error instanceof Error ? error.message : 'Не удалось сохранить подпись'); } finally { setSaving(false); } };
  if (loading) return <main className="grid min-h-screen place-items-center"><Loader2 className="h-6 w-6 animate-spin" /></main>;
  if (!document) return <main className="grid min-h-screen place-items-center p-6 text-center text-destructive">{message || 'Ссылка для подписания недействительна.'}</main>;
  if (document.pastor_signed_at) return <main className="grid min-h-screen place-items-center p-6 text-center"><div><PenLine className="mx-auto mb-3 h-8 w-8 text-primary" /><h1 className="text-xl font-semibold">Протокол уже подписан</h1><p className="mt-2 text-muted-foreground">Одноразовая ссылка больше недействительна.</p></div></main>;
  return <main className="min-h-screen bg-muted/30 p-4 sm:p-8"><section className="mx-auto max-w-xl space-y-5 rounded-xl border bg-card p-5 shadow-sm sm:p-8"><div><h1 className="text-2xl font-bold">Подписать протокол</h1><p className="mt-1 text-muted-foreground">Ведущий пастор: {document.pastor_name || 'не указан'}</p></div><Button variant="outline" className="w-full" onClick={() => window.open(document.pdf_url, '_blank', 'noopener,noreferrer')}>Открыть протокол PDF</Button><div><div className="mb-2 flex items-center justify-between"><label className="text-sm font-medium">Ваша подпись</label><Button type="button" variant="ghost" size="sm" onClick={clear}>Очистить</Button></div><canvas ref={canvasRef} width={700} height={220} className="h-40 w-full touch-none rounded-md border bg-white" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} /></div>{message && <p className={message.startsWith('Протокол подписан') ? 'text-sm text-green-700' : 'text-sm text-destructive'}>{message}</p>}<Button className="w-full" disabled={!hasSignature || saving} onClick={() => void sign()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Подписать протокол</Button></section></main>;
}
