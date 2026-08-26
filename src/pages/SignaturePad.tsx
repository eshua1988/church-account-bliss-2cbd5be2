import { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, Eraser, X, Loader2, Undo2 } from 'lucide-react';

const EXCHANGE_URL = 'https://htepbcotdqrewbxmasbf.supabase.co/functions/v1/sign-exchange';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh0ZXBiY290ZHFyZXdieG1hc2JmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTUzNDMsImV4cCI6MjA4MDE5MTM0M30.kHkWLZgXSZ93njS2JpTsWvQ4VKHJZb4ptuWq3ob_FsI';

export default function SignaturePad() {
  const [searchParams] = useSearchParams();
  const sid = searchParams.get('sid') || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<ImageData[]>([]);

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
      historyRef.current = [];
    };
    const raf = requestAnimationFrame(() => requestAnimationFrame(resize));
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  const saveSnapshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (historyRef.current.length > 50) historyRef.current.shift();
  };

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const r = canvasRef.current!.getBoundingClientRect();
    if ('touches' in e) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    saveSnapshot();
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
    saveSnapshot();
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setHasContent(false);
  };

  const undo = () => {
    const canvas = canvasRef.current;
    if (!canvas || historyRef.current.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const prev = historyRef.current.pop()!;
    ctx.putImageData(prev, 0, 0);
    // Check if canvas is now empty
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const isEmpty = !data.some(v => v !== 0);
    setHasContent(!isEmpty);
  };

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
      setTimeout(() => { try { window.close(); } catch (_) {} }, 2500);
    } catch (e) {
      setError('ĐžŃĐ¸Đ±ĐşĐ° ŃĐľŃ…Ń€Đ°Đ˝ĐµĐ˝Đ¸ŃŹ. ĐźĐľĐżŃ€ĐľĐ±ŃĐąŃ‚Đµ ĐµŃ‰Ń‘ Ń€Đ°Đ·.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  if (!sid) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', fontFamily:'sans-serif', color:'#666' }}>
      ĐťĐµĐ˛ĐµŃ€Đ˝Đ°ŃŹ ŃŃŃ‹Đ»ĐşĐ°
    </div>
  );

  if (done) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100dvh', gap:16, fontFamily:'sans-serif', backgroundColor:'#fff' }}>
      <CheckCircle style={{ width:56, height:56, color:'#22c55e' }} />
      <p style={{ fontSize:20, fontWeight:600, color:'#111' }}>ĐźĐľĐ´ĐżĐ¸ŃŃŚ ŃĐľŃ…Ń€Đ°Đ˝ĐµĐ˝Đ°!</p>
      <p style={{ fontSize:14, color:'#666', textAlign:'center', padding:'0 32px' }}>
        Đ’ĐµŃ€Đ˝Đ¸Ń‚ĐµŃŃŚ Đ˛ Telegram â€” ĐżĐľĐ´ĐżĐ¸ŃŃŚ ĐżĐľŃŹĐ˛Đ¸Ń‚ŃŃŹ Đ°Đ˛Ń‚ĐľĐĽĐ°Ń‚Đ¸Ń‡ĐµŃĐşĐ¸.
      </p>
      <button onClick={() => window.close()}
        style={{ marginTop:8, padding:'12px 32px', backgroundColor:'#6366f1', color:'#fff', border:'none', borderRadius:10, fontSize:16, fontWeight:600, cursor:'pointer' }}>
        Đ—Đ°ĐşŃ€Ń‹Ń‚ŃŚ Đ˛ĐşĐ»Đ°Đ´ĐşŃ
      </button>
    </div>
  );

  const canUndo = historyRef.current.length > 0;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100dvh', backgroundColor:'#f3f4f6', touchAction:'none', overflow:'hidden', userSelect:'none' }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', backgroundColor:'#fff', borderBottom:'1px solid #e5e7eb', flexShrink:0 }}>
        <button onClick={() => window.close()} style={{ padding:8, background:'none', border:'none', cursor:'pointer', color:'#6b7280' }}>
          <X style={{ width:24, height:24 }} />
        </button>
        <span style={{ fontWeight:700, fontSize:18, color:'#111' }}>ĐźĐľĐ´ĐżĐ¸ŃŃŚ ĐżĐľĐ»ŃŃ‡Đ°Ń‚ĐµĐ»ŃŹ</span>
        <div style={{ width:40 }} />
      </div>

      {/* Canvas â€” edge-to-edge, fills most of screen */}
      <div style={{ flex:1, padding:'10px 0', display:'flex', flexDirection:'column' }}>
        <p style={{ textAlign:'center', fontSize:13, color:'#9ca3af', marginBottom:6, flexShrink:0 }}>
          ĐťĐ°Ń€Đ¸ŃŃĐąŃ‚Đµ ĐżĐľĐ´ĐżĐ¸ŃŃŚ ĐżĐ°Đ»ŃŚŃ†ĐµĐĽ
        </p>
        <div style={{ flex:1, backgroundColor:'#fff', borderTop:'2px dashed #818cf8', borderBottom:'2px dashed #818cf8' }}>
          <canvas ref={canvasRef}
            style={{ width:'100%', height:'100%', display:'block', backgroundColor:'#ffffff', touchAction:'none', cursor:'crosshair' }}
            onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
            onTouchStart={e => { e.preventDefault(); e.stopPropagation(); startDraw(e); }}
            onTouchMove={e => { e.preventDefault(); e.stopPropagation(); draw(e); }}
            onTouchEnd={e => { e.preventDefault(); e.stopPropagation(); stopDraw(); }}
          />
        </div>
      </div>

      {/* Controls */}
      <div style={{ padding:'10px 16px 0', backgroundColor:'#fff', borderTop:'1px solid #e5e7eb', flexShrink:0 }}>
        {/* Undo & Clear row */}
        <div style={{ display:'flex', gap:10, marginBottom:10 }}>
          <button onClick={undo} disabled={!canUndo}
            style={{ flex:1, padding:'12px', display:'flex', alignItems:'center', justifyContent:'center', gap:6, backgroundColor: canUndo ? '#f3f4f6' : '#f9fafb', border:`1px solid ${canUndo ? '#d1d5db' : '#e5e7eb'}`, borderRadius:10, fontSize:15, fontWeight:600, color: canUndo ? '#374151' : '#9ca3af', cursor: canUndo ? 'pointer' : 'not-allowed' }}>
            <Undo2 style={{ width:20, height:20 }} />
            ĐžŃ‚ĐĽĐµĐ˝Đ¸Ń‚ŃŚ
          </button>
          <button onClick={clear} disabled={!hasContent}
            style={{ flex:1, padding:'12px', display:'flex', alignItems:'center', justifyContent:'center', gap:6, backgroundColor: hasContent ? '#fef2f2' : '#f9fafb', border:`1px solid ${hasContent ? '#fca5a5' : '#e5e7eb'}`, borderRadius:10, fontSize:15, fontWeight:600, color: hasContent ? '#ef4444' : '#9ca3af', cursor: hasContent ? 'pointer' : 'not-allowed' }}>
            <Eraser style={{ width:20, height:20 }} />
            ĐžŃ‡Đ¸ŃŃ‚Đ¸Ń‚ŃŚ
          </button>
        </div>

        {/* Confirm button */}
        {error && <p style={{ color:'#ef4444', fontSize:13, textAlign:'center', marginBottom:8 }}>{error}</p>}
        <button onClick={confirm} disabled={!hasContent || saving}
          style={{ width:'100%', padding:'18px', backgroundColor: hasContent && !saving ? '#22c55e' : '#d1d5db', color:'#fff', border:'none', borderRadius:14, fontSize:18, fontWeight:700, cursor: hasContent && !saving ? 'pointer' : 'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:'env(safe-area-inset-bottom, 16px)', transition:'background-color 0.2s', boxShadow: hasContent && !saving ? '0 4px 14px rgba(34,197,94,0.4)' : 'none' }}>
          {saving
            ? <><Loader2 style={{ width:24, height:24, animation:'spin 1s linear infinite' }} />ĐˇĐľŃ…Ń€Đ°Đ˝ĐµĐ˝Đ¸Đµ...</>
            : <><CheckCircle style={{ width:24, height:24 }} />ĐźĐľĐ´Ń‚Đ˛ĐµŃ€Đ´Đ¸Ń‚ŃŚ ĐżĐľĐ´ĐżĐ¸ŃŃŚ</>}
        </button>
      </div>
    </div>
  );
}
