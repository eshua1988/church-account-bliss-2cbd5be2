import { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, Eraser, X, Loader2 } from 'lucide-react';

const EXCHANGE_URL = 'https://htepbcotdqrewbxmasbf.supabase.co/functions/v1/sign-exchange';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0ZXBiY290ZHFyZXdieG1hc2JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTUzNDMsImV4cCI6MjA4MDE5MTM0M30.kHkWLZgXSZ93njS2JpTsWvQ4VKHJZb4ptuWq3ob_FsI';

/**
 * Standalone fullscreen signature page.
 * Opens in a real browser tab (Safari/Chrome) via Telegram.WebApp.openLink or <a target="_blank">.
 * On confirm → POST to sign-exchange Edge Function → PublicPayout polls and picks it up.
 */
export default function SignaturePad() {
  const [searchParams] = useSearchParams();
  const sid = searchParams.get('sid') || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resize canvas to fill the container after DOM layout
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      if (w === 0 || h === 0) return;
      const prevUrl = canvas.toDataURL();
      canvas.width = w;
      canvas.height = h;
      if (hasContent) {
        const img = new Image();
        img.onload = () => canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
        img.src = prevUrl;
      }
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(resize));
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    if ('touches' in e) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 2.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    setHasContent(true);
  };

  const stopDraw = () => setIsDrawing(false);

  const clear = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setHasContent(false);
  };

  // POST signature to Edge Function → PublicPayout will poll it
  const confirm = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasContent) return;
    setSaving(true); setError(null);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const res = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ sid, data_url: dataUrl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDone(true);
      // Close tab after delay
      setTimeout(() => { try { window.close(); } catch (_) {} }, 2500);
    } catch (e) {
      setError('Ошибка сохранения. Попробуйте ещё раз.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!sid) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', fontFamily:'sans-serif', color:'#666' }}>
      Неверная ссылка
    </div>
  );

  if (done) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100dvh', gap:16, fontFamily:'sans-serif', backgroundColor:'#fff' }}>
      <CheckCircle style={{ width:56, height:56, color:'#22c55e' }} />
      <p style={{ fontSize:20, fontWeight:600, color:'#111' }}>Подпись сохранена!</p>
      <p style={{ fontSize:14, color:'#666', textAlign:'center', padding:'0 32px' }}>
        Вернитесь в Telegram — подпись появится автоматически.
      </p>
      <button onClick={() => window.close()}
        style={{ marginTop:8, padding:'12px 32px', backgroundColor:'#6366f1', color:'#fff', border:'none', borderRadius:10, fontSize:16, fontWeight:600, cursor:'pointer' }}>
        Закрыть вкладку
      </button>
    </div>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', backgroundColor:'#ffffff', touchAction:'none', overflow:'hidden', userSelect:'none' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
        <button onClick={() => window.close()} style={{ padding:8, background:'none', border:'none', cursor:'pointer', color:'#6b7280' }}>
          <X style={{ width:24, height:24 }} />
        </button>
        <span style={{ fontWeight:700, fontSize:18, color:'#111' }}>Подпись получателя</span>
        <button onClick={clear} style={{ display:'flex', alignItems:'center', gap:4, padding:'6px 10px', background:'none', border:'1px solid #d1d5db', borderRadius:8, cursor:'pointer', color:'#6b7280', fontSize:14 }}>
          <Eraser style={{ width:18, height:18 }} /> Очистить
        </button>
      </div>

      <p style={{ textAlign:'center', fontSize:13, color:'#9ca3af', padding:'6px 0 2px', flexShrink:0 }}>
        Нарисуйте подпись пальцем
      </p>

      {/* Canvas */}
      <div style={{ flex:1, backgroundColor:'#f9fafb', padding:12 }}>
        <canvas ref={canvasRef}
          style={{ width:'100%', height:'100%', display:'block', backgroundColor:'#ffffff', borderRadius:12, border:'2px dashed #818cf8', touchAction:'none', cursor:'crosshair' }}
          onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
          onTouchStart={e => { e.preventDefault(); e.stopPropagation(); startDraw(e); }}
          onTouchMove={e => { e.preventDefault(); e.stopPropagation(); draw(e); }}
          onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); stopDraw(); }}
        />
      </div>

      {/* Confirm */}
      <div style={{ padding:'12px 16px 32px', flexShrink:0, backgroundColor:'#fff' }}>
        {error && <p style={{ color:'#ef4444', fontSize:13, textAlign:'center', marginBottom:8 }}>{error}</p>}
        <button onClick={confirm} disabled={!hasContent || saving}
          style={{ width:'100%', padding:'16px', backgroundColor: hasContent && !saving ? '#6366f1' : '#d1d5db', color:'#fff', border:'none', borderRadius:12, fontSize:17, fontWeight:700, cursor: hasContent && !saving ? 'pointer' : 'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'background-color 0.2s' }}>
          {saving
            ? <><Loader2 style={{ width:22, height:22, animation:'spin 1s linear infinite' }} />Сохранение...</>
            : <><CheckCircle style={{ width:22, height:22 }} />Подтвердить подпись</>}
        </button>
      </div>
    </div>
  );
}