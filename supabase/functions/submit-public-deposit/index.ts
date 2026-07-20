import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';
import { ROBOTO_FONT_BASE64 } from '../_shared/robotoFont.ts';
import { amountInPolishWords, type DepositCurrency } from '../_shared/amountInWords.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const text = (value: unknown, max = 500) => String(value || '').trim().slice(0, max);
const allowedCurrencies = ['PLN', 'USD', 'EUR', 'UAH', 'OTHER'];

interface DepositSigner {
  fullName: string;
  signatureBase64: string;
}

interface DepositEntry {
  amount: number;
  currency: DepositCurrency;
  customCurrency: string;
  date: string;
  basis: string;
  signers: DepositSigner[];
}

const parseEntry = (value: Record<string, unknown>): DepositEntry => {
  const rawSigners = Array.isArray(value.signers) ? value.signers : [];
  const signers = rawSigners.length > 0
    ? rawSigners.map(raw => {
      const signer = (raw || {}) as Record<string, unknown>;
      return { fullName: text(signer.fullName), signatureBase64: text(signer.signatureBase64, 2_000_000) };
    })
    : [{ fullName: text(value.receivedFrom), signatureBase64: text(value.signatureBase64, 2_000_000) }];
  return {
    amount: Number(value.amount),
    currency: text(value.currency, 5).toUpperCase() as DepositCurrency,
    customCurrency: text(value.customCurrency, 20),
    date: text(value.date, 10),
    basis: text(value.basis),
    signers,
  };
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await request.json();
    const token = text(body.token, 100);
    const rawEntries = Array.isArray(body.entries) && body.entries.length > 0 ? body.entries : [body];
    if (rawEntries.length > 50) {
      return new Response(JSON.stringify({ error: 'Too many receipts' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const entries = rawEntries.map((entry: Record<string, unknown>) => parseEntry(entry));
    const invalid = !token || entries.some(entry =>
      !entry.amount || entry.amount <= 0 || !entry.date || !entry.basis ||
      entry.signers.length === 0 || entry.signers.length > 10 || entry.signers.some(signer => !signer.fullName) ||
      !allowedCurrencies.includes(entry.currency) ||
      (entry.currency === 'OTHER' && !entry.customCurrency),
    );
    if (invalid) {
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
    doc.addFileToVFS('Roboto-Regular.ttf', ROBOTO_FONT_BASE64);
    doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
    doc.setFont('Roboto', 'normal');
    const organization = text(body.organizationName || link.organization_name || 'ZBÓR BIBLIJNY KOŚCIÓŁ W WARSZAWIE', 200);

    const drawLineText = (label: string, value: string, x: number, y: number, width: number) => {
      const defaultSize = 8;
      doc.setFontSize(defaultSize);
      doc.text(label, x, y);
      const labelWidth = doc.getTextWidth(label) + 1;
      doc.line(x + labelWidth, y + 1, x + width, y + 1);
      if (!value) return;
      const availableWidth = Math.max(width - labelWidth - 2, 4);
      let fontSize = defaultSize;
      doc.setFontSize(fontSize);
      while (doc.getTextWidth(value) > availableWidth && fontSize > 5) {
        fontSize -= 0.25;
        doc.setFontSize(fontSize);
      }
      doc.text(value, x + labelWidth + 1, y);
      doc.setFontSize(defaultSize);
    };

    const drawReceipt = (entry: DepositEntry, offsetY: number) => {
      const leftX = 12;
      const width = 186;
      const currencyLabel = entry.currency === 'OTHER' ? entry.customCurrency : entry.currency;
      const amountText = `${entry.amount.toFixed(2)} ${currencyLabel}`;
      const amountWords = amountInPolishWords(entry.amount, entry.currency, entry.customCurrency);
      doc.setDrawColor(0);
      doc.setLineWidth(0.25);
      doc.setFontSize(8.5);
      doc.text(organization, leftX + width / 2, offsetY + 7, { align: 'center', maxWidth: width - 8 });
      doc.setFontSize(8);
      doc.text('БИБЛЕЙСКАЯ ЦЕРКОВЬ В ВАРШАВЕ', leftX + width / 2, offsetY + 13, { align: 'center' });
      doc.setFontSize(9.5);
      doc.text('DOWÓD WPŁATY', leftX + width / 2, offsetY + 20, { align: 'center' });

      doc.rect(leftX, offsetY + 22, width, 13);
      doc.line(leftX + width / 2, offsetY + 22, leftX + width / 2, offsetY + 35);
      doc.line(leftX, offsetY + 27, leftX + width, offsetY + 27);
      doc.setFontSize(7.5);
      doc.text('Kwota', leftX + width / 4, offsetY + 26, { align: 'center' });
      doc.text('Data', leftX + width * 0.75, offsetY + 26, { align: 'center' });
      doc.text(amountText, leftX + width / 4, offsetY + 33, { align: 'center' });
      doc.text(entry.date, leftX + width * 0.75, offsetY + 33, { align: 'center' });

      drawLineText('Podstawa:', entry.basis, leftX + 1, offsetY + 45, width - 2);
      doc.line(leftX + 1, offsetY + 53, leftX + width - 1, offsetY + 53);
      drawLineText('Kwota słownie:', amountWords, leftX + 1, offsetY + 62, width - 2);
      doc.line(leftX + 1, offsetY + 70, leftX + width - 1, offsetY + 70);

      const signerTop = offsetY + 76;
      const signerHeight = 18;
      doc.setFontSize(8);
      entry.signers.forEach((signer, signerIndex) => {
        const rowTop = signerTop + signerIndex * signerHeight;
        doc.rect(leftX, rowTop, width, signerHeight);
        doc.line(leftX + 126, rowTop, leftX + 126, rowTop + signerHeight);
        doc.text(entry.signers.length > 1 ? `Nadawca ${signerIndex + 1}:` : 'Nadawca:', leftX + 1, rowTop + 10);
        doc.text(signer.fullName, leftX + 25, rowTop + 10, { maxWidth: 99 });
        if (signer.signatureBase64) {
          try { doc.addImage(`data:image/png;base64,${signer.signatureBase64}`, 'PNG', leftX + 128, rowTop + 2, 56, 14); } catch { /* ignore malformed signature */ }
        }
      });
      const cashierTop = signerTop + entry.signers.length * signerHeight + 4;
      doc.rect(leftX, cashierTop, width, 12);
      doc.text('Kasjer:', leftX + 1, cashierTop + 8);
      return { height: cashierTop + 12 - offsetY, cashierTop };
    };

    const receiptLayouts: Array<{ pageIndex: number; offsetY: number; cashierTop: number }> = [];
    let pageIndex = 0;
    let cursorY = 10;
    entries.forEach(entry => {
      const expectedHeight = 92 + entry.signers.length * 18;
      if (cursorY > 10 && cursorY + expectedHeight > 287) {
        doc.addPage();
        pageIndex += 1;
        cursorY = 10;
      }
      const layout = drawReceipt(entry, cursorY);
      receiptLayouts.push({ pageIndex, offsetY: cursorY, cashierTop: layout.cashierTop });
      cursorY += layout.height + 10;
    });

    const folderKey = crypto.randomUUID();
    const firstDate = entries[0].date;
    const fileName = `dowod_wplaty_${firstDate}_${folderKey.slice(0, 8)}.pdf`;
    const pdfPath = `${link.owner_user_id}/${folderKey}/${fileName}`;
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    const { error: uploadError } = await supabase.storage.from('documents').upload(pdfPath, bytes, {
      contentType: 'application/pdf',
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const receiptMetadata = entries.map((entry, index) => ({
      amount: entry.amount,
      currency: entry.currency,
      custom_currency: entry.customCurrency || null,
      issued_to: entry.signers.map(signer => signer.fullName).join(', '),
      senders: entry.signers.map(signer => ({ full_name: signer.fullName })),
      basis: entry.basis,
      amount_in_words: amountInPolishWords(entry.amount, entry.currency, entry.customCurrency),
      date: entry.date,
      page_index: receiptLayouts[index].pageIndex,
      offset_y_mm: receiptLayouts[index].offsetY,
      cashier_top_mm: receiptLayouts[index].cashierTop,
      cashier_height_mm: 12,
    }));
    const metadata = {
      folder_key: folderKey,
      link_token: token,
      pdf_path: pdfPath,
      receipts: receiptMetadata,
      receipt_count: entries.length,
      ...receiptMetadata[0],
      document_type: 'deposit',
    };
    const first = entries[0];
    const firstCurrency = first.currency === 'OTHER' ? first.customCurrency : first.currency;
    const { data: notification, error: notificationError } = await supabase.from('notifications').insert({
      user_id: link.owner_user_id,
      title: entries.length > 1 ? `Новые Dowód wpłaty (${entries.length})` : 'Новый Dowód wpłaty',
      message: entries.length > 1
        ? `${entries.length} квитанции в одном PDF`
        : `${first.signers.map(signer => signer.fullName).join(', ')}: ${first.amount.toFixed(2)} ${firstCurrency}`,
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

    return new Response(JSON.stringify({ success: true, pdfPath, receiptCount: entries.length }), {
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
