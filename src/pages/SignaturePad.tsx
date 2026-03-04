import { useRef, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle, Eraser, X } from 'lucide-react';

/**
 * Standalone fullscreen signature page.
 * Opens in a real browser tab from PublicPayout.
 * On confirm - writes result to localStorage and closes itself.
 * PublicPayout listens via the 'storage' event.
 */
export default function SignaturePad() {
  const [searchParams] = useSearchParams();
  const sid = searchParams.get('sid') || '';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [done, setDone] = useState(false);

  // Resize canvas to fill screen
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      // Save current drawing
      const dataUrl = canvas.toDataURL();
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      const ctx = canvas.getContext('2d');
      if (ctx && hasContent) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = dataUrl;
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    setHasContent(true);
  };

  const stopDraw = () => setIsDrawing(false);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasContent(false);
  };

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasContent) return;
    const dataUrl = canvas.toDataURL('image/png');
    // Write result so the parent tab can pick it up via storage event
    localStorage.setItem(`sig_result_${sid}`, dataUrl);
    setDone(true);
    // Try to close this tab after a short delay
    setTimeout(() => { try { window.close(); } catch (_) {} }, 1200);
  };

  if (!sid) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'sans-serif', color: '#666' }}>
        Неверная ссылка
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', gap: 16, fontFamily: 'sans-serif', backgroundColor: '#fff' }}>
        <CheckCircle style={{ width: 56, height: 56, color: '#22c55e' }} />
        <p style={{ fontSize: 20, fontWeight: 600, color: '#111' }}>Подпись сохранена!</p>
        <p style={{ fontSize: 14, color: '#666', textAlign: 'center', padding: '0 32px' }}>
          Вернитесь на предыдущую вкладку — подпись появится автоматически.
        </p>
        <button
          onClick={() => window.close()}
          style={{ marginTop: 8, padding: '12px 32px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer' }}
        >
          Закрыть вкладку
        </button>
      </div>
    );
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100dvh', backgroundColor: '#ffffff', touchAction: 'none', overflow: 'hidden', userSelect: 'none' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e5e7eb', flexShrink: 0, backgroundColor: '#fff' }}>
        <button
          onClick={() => window.close()}
          style={{ padding: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
        >
          <X style={{ width: 24, height: 24 }} />
        </button>
        <span style={{ fontWeight: 700, fontSize: 18, color: '#111' }}>Подпись получателя</span>
        <button
          onClick={clear}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', background: 'none', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', color: '#6b7280', fontSize: 14 }}
        >
          <Eraser style={{ width: 18, height: 18 }} />
          Очистить
        </button>
      </div>

      {/* Hint */}
      <p style={{ textAlign: 'center', fontSize: 13, color: '#9ca3af', padding: '6px 0 2px', flexShrink: 0 }}>
        Нарисуйте подпись пальцем
      </p>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#f9fafb', padding: 12 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            backgroundColor: '#ffffff',
            borderRadius: 12,
            border: '2px dashed #818cf8',
            touchAction: 'none',
            cursor: 'crosshair',
          }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={stopDraw}
          onMouseLeave={stopDraw}
          onTouchStart={(e) => { e.preventDefault(); e.stopPropagation(); startDraw(e); }}
          onTouchMove={(e) => { e.preventDefault(); e.stopPropagation(); draw(e); }}
          onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); stopDraw(); }}
        />
      </div>

      {/* Confirm button */}
      <div style={{ padding: '12px 16px 32px', flexShrink: 0, backgroundColor: '#fff' }}>
        <button
          onClick={confirm}
          disabled={!hasContent}
          style={{
            width: '100%',
            padding: '16px',
            backgroundColor: hasContent ? '#6366f1' : '#d1d5db',
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontSize: 17,
            fontWeight: 700,
            cursor: hasContent ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'background-color 0.2s',
          }}
        >
          <CheckCircle style={{ width: 22, height: 22 }} />
          Подтвердить подпись
        </button>
      </div>
    </div>
  );
}
