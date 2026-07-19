import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const text = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);

async function loadRobotoFont(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.storage.from('documents').download('fonts/Roboto-Regular.ttf');
  if (!data) return null;
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json();
    const token = text(body.token, 100);
    const amount = Number(body.amount);
    const date = text(body.date, 10);
    const receivedFrom = text(body.receivedFrom);
    const basis = text(body.basis);
    const amountInWords = text(body.amountInWords);
    const cashier = text(body.cashier, 150);
    const signatureBase64 = text(body.signatureBase64, 2_000_000);
    if (!token || !amount || amount <= 0 || !date || !receivedFrom || !basis) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: link, error: linkError } = await supabase
      .from('shared_payout_links')
      .select('owner_user_id, is_active, expires_at, organization_name, link_type')
      .eq('token', token)
      .single();
    if (linkError || !link || link.link_type !== 'deposit' || !link.is_active || (link.expires_at && new Date(link.expires_at) < new Date())) {
      return new Response(JSON.stringify({ error: 'Invalid or expired link' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const font = await loadRobotoFont(supabase);
    if (font) {
      doc.addFileToVFS('Roboto-Regular.ttf', font);
      doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
      doc.setFont('Roboto');
    }
    const organization = text(body.organizationName || link.organization_name || 'ZBÓR BIBLIJNY KOŚCIÓŁ W WARSZAWIE', 200);
    const amountText = `${amount.toFixed(2)} PLN`;

    const drawLineText = (label: string, value: string, x: number, y: number, width: number) => {
      doc.setFontSize(8.5);
      doc.text(label, x, y);
      const labelWidth = doc.getTextWidth(label) + 1;
      doc.line(x + labelWidth, y + 1, x + width, y + 1);
      if (value) doc.text(value, x + labelWidth + 1, y);
    };

    const drawCopy = (offsetY: number) => {
      const leftX = 8;
      const leftW = 130;
      const rightX = 145;
      const rightW = 57;
      const dividerX = 141.5;
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.setLineDashPattern([0.7, 0.7], 0);
      doc.line(dividerX, offsetY + 4, dividerX, offsetY + 130);
      doc.setLineDashPattern([], 0);

      doc.setFontSize(9);
      doc.text(organization, leftX + leftW / 2, offsetY + 10, { align: 'center', maxWidth: leftW - 8 });
      doc.setFontSize(8.5);
      doc.text('БИБЛЕЙСКАЯ ЦЕРКОВЬ В ВАРШАВЕ', leftX + leftW / 2, offsetY + 17, { align: 'center' });
      doc.setFontSize(10);
      doc.text('DOWÓD WPŁATY', leftX + leftW / 2, offsetY + 25, { align: 'center' });

      doc.rect(leftX, offsetY + 27, leftW, 14);
      doc.line(leftX + 52, offsetY + 27, leftX + 52, offsetY + 41);
      doc.line(leftX + 104, offsetY + 27, leftX + 104, offsetY + 41);
      doc.line(leftX, offsetY + 32, leftX + leftW, offsetY + 32);
      doc.setFontSize(8);
      doc.text('Kwota', leftX + 26, offsetY + 31, { align: 'center' });
      doc.text('Data', leftX + 78, offsetY + 31, { align: 'center' });
      doc.text(amountText, leftX + 26, offsetY + 38, { align: 'center' });
      doc.text(date, leftX + 78, offsetY + 38, { align: 'center' });

      drawLineText('Podstawa:', basis, leftX + 1, offsetY + 51, leftW - 2);
      doc.line(leftX + 1, offsetY + 60, leftX + leftW - 1, offsetY + 60);
      drawLineText('Kwota słownie:', amountInWords, leftX + 1, offsetY + 69, leftW - 2);
      doc.line(leftX + 1, offsetY + 78, leftX + leftW - 1, offsetY + 78);
      doc.line(leftX + 1, offsetY + 87, leftX + leftW - 1, offsetY + 87);

      doc.rect(leftX, offsetY + 92, leftW, 16);
      doc.line(leftX + 78, offsetY + 92, leftX + 78, offsetY + 108);
      doc.text('Podpis nadawca:', leftX + 1, offsetY + 100);
      if (signatureBase64) {
        try { doc.addImage(`data:image/png;base64,${signatureBase64}`, 'PNG', leftX + 80, offsetY + 93, 47, 14); } catch { /* ignore malformed signature */ }
      }
      doc.rect(leftX, offsetY + 112, leftW, 16);
      doc.line(leftX + 78, offsetY + 112, leftX + 78, offsetY + 128);
      doc.text('Podpis kasjer:', leftX + 1, offsetY + 120);
      if (cashier) doc.text(cashier, leftX + 80, offsetY + 120);

      doc.rect(rightX, offsetY + 2, rightW, 128);
      doc.setFontSize(8.5);
      doc.text('«BOŻA ŁASKA» W WARSZAWIE', rightX + rightW / 2, offsetY + 13, { align: 'center', maxWidth: rightW - 4 });
      doc.text('ЦЕРКОВЬ ХРИСТИАН БАПТИСТОВ', rightX + rightW / 2, offsetY + 19, { align: 'center', maxWidth: rightW - 4 });
      doc.text('«БОЖЬЯ БЛАГОДАТЬ» В ВАРШАВЕ', rightX + rightW / 2, offsetY + 25, { align: 'center', maxWidth: rightW - 4 });
      doc.setFontSize(9);
      doc.text('PARAGON', rightX + rightW / 2, offsetY + 34, { align: 'center' });
      doc.setFontSize(8);
      doc.text('dowodu wpłaty', rightX + rightW / 2, offsetY + 44, { align: 'center' });
      doc.rect(rightX, offsetY + 46, rightW, 12);
      doc.line(rightX + rightW / 2, offsetY + 46, rightX + rightW / 2, offsetY + 58);
      doc.line(rightX, offsetY + 51, rightX + rightW, offsetY + 51);
      doc.text('Kwota', rightX + rightW / 4, offsetY + 50, { align: 'center' });
      doc.text('Data', rightX + rightW * 0.75, offsetY + 50, { align: 'center' });
      doc.text(amountText, rightX + rightW / 4, offsetY + 56, { align: 'center' });
      doc.text(date, rightX + rightW * 0.75, offsetY + 56, { align: 'center' });
      drawLineText('Otrzymano od:', receivedFrom, rightX + 1, offsetY + 67, rightW - 3);
      drawLineText('Podstawa:', basis, rightX + 1, offsetY + 77, rightW - 3);
      doc.line(rightX + 1, offsetY + 86, rightX + rightW - 2, offsetY + 86);
      doc.line(rightX + 1, offsetY + 95, rightX + rightW - 2, offsetY + 95);
      drawLineText('Kwota słownie:', amountInWords, rightX + 1, offsetY + 105, rightW - 3);
      doc.line(rightX + 1, offsetY + 113, rightX + rightW - 2, offsetY + 113);
      drawLineText('Kasjer:', cashier, rightX + 1, offsetY + 122, rightW - 3);
      doc.text('Podpis kasjera:', rightX + 1, offsetY + 128);
    };

    drawCopy(3);
    drawCopy(151);

    const folderKey = crypto.randomUUID();
    const fileName = `dowod_wplaty_${date}_${folderKey.slice(0, 8)}.pdf`;
    const pdfPath = `${link.owner_user_id}/${folderKey}/${fileName}`;
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    const { error: uploadError } = await supabase.storage.from('documents').upload(pdfPath, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const metadata = {
      folder_key: folderKey,
      link_token: token,
      pdf_path: pdfPath,
      amount,
      currency: 'PLN',
      issued_to: receivedFrom,
      basis,
      amount_in_words: amountInWords,
      cashier,
      date,
      document_type: 'deposit',
    };
    const { data: notification, error: notificationError } = await supabase.from('notifications').insert({
      user_id: link.owner_user_id,
      title: 'Новый Dowód wpłaty',
      message: `${receivedFrom}: ${amountText}`,
      type: 'deposit',
      metadata,
    }).select('id').single();
    if (notificationError) throw notificationError;

    if (notification?.id) {
      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ notification_id: notification.id }),
      }).catch(console.error);
    }

    return new Response(JSON.stringify({ success: true, pdfPath }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
