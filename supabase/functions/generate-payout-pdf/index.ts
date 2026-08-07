import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const DEFAULT_ORG_NAME = 'ZBÓR BIBLIJNYCH CHRZEŚCIJAN W WARSZAWIE';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { transactionId, ownerUserId } = await req.json();

    if (!transactionId || !ownerUserId) {
      return new Response(
        JSON.stringify({ error: 'Missing transactionId or ownerUserId' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch transaction
    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('id, date, amount, currency, issued_to, description, amount_in_words, cashier_name, decision_number')
      .eq('id', transactionId)
      .eq('user_id', ownerUserId)
      .single();

    if (txError || !tx) {
      return new Response(
        JSON.stringify({ error: 'Transaction not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: brandingLink } = await supabase
      .from('shared_payout_links')
      .select('organization_name')
      .eq('owner_user_id', ownerUserId)
      .not('organization_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const organizationName = brandingLink?.organization_name || DEFAULT_ORG_NAME;

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    const leftMargin = 20;
    const tableWidth = pageWidth - 40;
    const labelColWidth = 50;
    const valueColWidth = tableWidth - labelColWidth;
    const rowHeight = 10;
    const cellPadding = 3;

    const drawCell = (x: number, y: number, width: number, height: number, text: string, fill = false) => {
      if (fill) {
        doc.setFillColor(240, 240, 240);
        doc.rect(x, y, width, height, 'F');
      }
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(x, y, width, height, 'S');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(text, width - cellPadding * 2);
      doc.text(lines[0] || '', x + cellPadding, y + height / 2 + 3);
    };

    doc.setFontSize(11);
    doc.text(organizationName, pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.text('Dowód wypłaty', pageWidth / 2, 32, { align: 'center' });

    let yPos = 45;

    const smallTableWidth = (tableWidth - 10) / 2;
    const smallLabelWidth = 35;
    const smallValueWidth = smallTableWidth - smallLabelWidth;

    const dateStr = tx.date ? new Date(tx.date).toISOString().split('T')[0] : '';
    drawCell(leftMargin, yPos, smallLabelWidth, rowHeight, 'Data', true);
    drawCell(leftMargin + smallLabelWidth, yPos, smallValueWidth, rowHeight, dateStr);

    const amountTableX = leftMargin + smallTableWidth + 10;
    drawCell(amountTableX, yPos, smallLabelWidth + 10, rowHeight, `Kwota (${tx.currency || ''})`, true);
    drawCell(amountTableX + smallLabelWidth + 10, yPos, smallValueWidth - 10, rowHeight, `${tx.amount || ''}`);

    yPos += rowHeight + 8;

    const drawRow = (label: string, value: string) => {
      drawCell(leftMargin, yPos, labelColWidth, rowHeight, label, true);
      drawCell(leftMargin + labelColWidth, yPos, valueColWidth, rowHeight, value);
      yPos += rowHeight;
    };

    drawRow('Wydano (imię nazwisko)', tx.issued_to || '');
    drawRow('Konto dla przelewu', tx.decision_number || '');
    drawRow('Nazwa działu', tx.cashier_name || '');

    // Basis
    const basisText = tx.description || '';
    const basisLines = doc.splitTextToSize(basisText, valueColWidth - cellPadding * 2);
    const basisHeight = Math.max(rowHeight * 2, basisLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, basisHeight, 'Na podstawie', true);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, basisHeight, 'S');
    doc.setFontSize(10);
    if (basisLines.length > 0) {
      doc.text(basisLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    }
    yPos += basisHeight;

    // Amount in words
    const wordsText = tx.amount_in_words || '';
    const wordsLines = doc.splitTextToSize(wordsText, valueColWidth - cellPadding * 2);
    const wordsHeight = Math.max(rowHeight * 2, wordsLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, wordsHeight, 'Kwota slownie', true);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, wordsHeight, 'S');
    doc.setFontSize(10);
    if (wordsLines.length > 0) {
      doc.text(wordsLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    }
    yPos += wordsHeight + 15;

    // Recipient signature box
    const signatureBoxWidth = 150;
    const signatureBoxHeight = 40;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPos, signatureBoxWidth, signatureBoxHeight, 'S');
    doc.setFontSize(10);
    doc.text('Podpis odbiorcy:', leftMargin + 3, yPos + 8);

    // Check if signature exists in Storage
    const sigPath = `${ownerUserId}/${transactionId}/signature.png`;
    const { data: sigData } = await supabase.storage
      .from('documents')
      .download(sigPath);

    if (sigData) {
      try {
        const sigArrayBuffer = await sigData.arrayBuffer();
        const sigBytes = new Uint8Array(sigArrayBuffer);
        let binary = '';
        for (let i = 0; i < sigBytes.length; i++) {
          binary += String.fromCharCode(sigBytes[i]);
        }
        const sigBase64 = btoa(binary);
        doc.addImage(`data:image/png;base64,${sigBase64}`, 'PNG', leftMargin + 5, yPos + 2, 140, 36);
      } catch (e) {
        console.error('Failed to embed signature:', e);
      }
    }

    // Return PDF as base64
    const pdfBase64 = doc.output('datauristring').split(',')[1];
    const issuedTo = (tx.issued_to || 'dokument').replace(/\s/g, '_');
    const fileName = `dowod_wyplaty_${dateStr}_${issuedTo}.pdf`;

    return new Response(
      JSON.stringify({ success: true, pdfBase64, fileName }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
