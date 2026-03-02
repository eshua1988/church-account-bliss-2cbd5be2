import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Valid currencies
const VALID_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH', 'RUB', 'BYN'];

// Rate limiting: max submissions per token per hour
const MAX_SUBMISSIONS_PER_HOUR = 10;

// Text field max lengths
const MAX_TEXT_LENGTH = 500;
const MAX_AMOUNT = 10000000; // 10 million

interface SubmitPayoutRequest {
  token: string;
  amount: number;
  currency: string;
  categoryId?: string;
  description?: string;
  date: string;
  issuedTo?: string;
  amountInWords?: string;
  submitterName?: string;
  imagesSkipped?: boolean;
  departmentName?: string;
}

// Simple in-memory rate limiting (per token)
const rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  
  const existing = rateLimitStore.get(token);
  
  if (!existing || existing.resetTime < now) {
    rateLimitStore.set(token, { count: 1, resetTime: now + hourMs });
    return true;
  }
  
  if (existing.count >= MAX_SUBMISSIONS_PER_HOUR) {
    return false;
  }
  
  existing.count++;
  return true;
}

function validateInput(data: SubmitPayoutRequest): { valid: boolean; error?: string } {
  if (!data.token || typeof data.token !== 'string' || data.token.length < 10 || data.token.length > 100) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  if (typeof data.amount !== 'number' || isNaN(data.amount)) {
    return { valid: false, error: 'Amount must be a number' };
  }
  if (data.amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  if (data.amount > MAX_AMOUNT) {
    return { valid: false, error: `Amount cannot exceed ${MAX_AMOUNT}` };
  }
  
  if (!data.currency || !VALID_CURRENCIES.includes(data.currency)) {
    return { valid: false, error: `Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}` };
  }
  
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { valid: false, error: 'Invalid date format. Use YYYY-MM-DD' };
  }
  
  const dateObj = new Date(data.date);
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const oneMonthAhead = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  
  if (dateObj < oneYearAgo) {
    return { valid: false, error: 'Date cannot be more than 1 year in the past' };
  }
  if (dateObj > oneMonthAhead) {
    return { valid: false, error: 'Date cannot be more than 1 month in the future' };
  }
  
  const textFields: (keyof SubmitPayoutRequest)[] = ['description', 'issuedTo', 'amountInWords'];
  for (const field of textFields) {
    const value = data[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string') {
        return { valid: false, error: `${field} must be a string` };
      }
      if (value.length > MAX_TEXT_LENGTH) {
        return { valid: false, error: `${field} cannot exceed ${MAX_TEXT_LENGTH} characters` };
      }
    }
  }
  
  if (data.categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.categoryId)) {
    return { valid: false, error: 'Invalid category ID format' };
  }

  return { valid: true };
}

/**
 * Generate a simple PDF on the server and upload to Storage.
 * Returns the storage path on success, null on failure.
 */
async function generateAndUploadPdf(
  supabase: ReturnType<typeof createClient>,
  ownerUserId: string,
  transactionId: string,
  data: {
    date: string;
    amount: number;
    currency: string;
    issuedTo?: string;
    departmentName?: string;
    description?: string;
    amountInWords?: string;
  }
): Promise<string | null> {
  try {
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
      const lines = doc.splitTextToSize(String(text || ''), width - cellPadding * 2);
      doc.text(lines[0] || '', x + cellPadding, y + height / 2 + 3);
    };

    doc.setFontSize(11);
    doc.text('ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE', pageWidth / 2, 20, { align: 'center' });
    doc.setFontSize(16);
    doc.text('Dowód wypłaty', pageWidth / 2, 32, { align: 'center' });

    let yPos = 45;

    const smallTableWidth = (tableWidth - 10) / 2;
    const smallLabelWidth = 35;
    const smallValueWidth = smallTableWidth - smallLabelWidth;

    drawCell(leftMargin, yPos, smallLabelWidth, rowHeight, 'Data', true);
    drawCell(leftMargin + smallLabelWidth, yPos, smallValueWidth, rowHeight, data.date);

    const amountTableX = leftMargin + smallTableWidth + 10;
    drawCell(amountTableX, yPos, smallLabelWidth + 10, rowHeight, `Kwota (${data.currency})`, true);
    drawCell(amountTableX + smallLabelWidth + 10, yPos, smallValueWidth - 10, rowHeight, `${data.amount}`);

    yPos += rowHeight + 8;

    const drawRow = (label: string, value: string) => {
      drawCell(leftMargin, yPos, labelColWidth, rowHeight, label, true);
      drawCell(leftMargin + labelColWidth, yPos, valueColWidth, rowHeight, value);
      yPos += rowHeight;
    };

    drawRow('Wydano (imię nazwisko)', data.issuedTo || '');
    drawRow('Nazwa działu', data.departmentName || '');

    // Basis (multi-line)
    const basisText = data.description || '';
    const basisLines = doc.splitTextToSize(basisText, valueColWidth - cellPadding * 2);
    const basisHeight = Math.max(rowHeight * 2, basisLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, basisHeight, 'Na podstawie', true);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, basisHeight, 'S');
    doc.setFontSize(10);
    if (basisLines.length > 0) {
      doc.text(basisLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    }
    yPos += basisHeight;

    // Amount in words (multi-line)
    const wordsText = data.amountInWords || '';
    const wordsLines = doc.splitTextToSize(wordsText, valueColWidth - cellPadding * 2);
    const wordsHeight = Math.max(rowHeight * 2, wordsLines.length * 6 + cellPadding * 2);
    drawCell(leftMargin, yPos, labelColWidth, wordsHeight, 'Kwota słownie', true);
    doc.rect(leftMargin + labelColWidth, yPos, valueColWidth, wordsHeight, 'S');
    doc.setFontSize(10);
    if (wordsLines.length > 0) {
      doc.text(wordsLines, leftMargin + labelColWidth + cellPadding, yPos + cellPadding + 6);
    }
    yPos += wordsHeight + 15;

    doc.setFontSize(10);
    doc.text('Kasjer: ________________________________', leftMargin, yPos);
    doc.text('Podpis kasjera: ________________________________', pageWidth / 2, yPos);
    yPos += 15;

    doc.setFontSize(11);
    doc.text('Podpis odbiorcy:', leftMargin, yPos);
    yPos += 5;
    doc.setDrawColor(0);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPos, 150, 40, 'S');

    // Try to embed signature if it was already uploaded
    const sigPath = `${ownerUserId}/${transactionId}/signature.png`;
    const { data: sigBlob } = await supabase.storage.from('documents').download(sigPath);
    if (sigBlob) {
      try {
        const sigArrayBuffer = await sigBlob.arrayBuffer();
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

    // Convert to Uint8Array and upload to Storage
    const pdfOutput = doc.output('arraybuffer');
    const pdfBytes = new Uint8Array(pdfOutput);

    const issuedTo = (data.issuedTo || 'dokument').replace(/[^a-zA-Z0-9]/g, '_');
    const fileName = `dowod_wyplaty_${data.date}_${issuedTo}.pdf`;
    const storagePath = `${ownerUserId}/${transactionId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error('PDF upload to storage failed:', uploadError);
      return null;
    }

    console.log('Server-side PDF uploaded to:', storagePath);
    return storagePath;
  } catch (e) {
    console.error('Server-side PDF generation failed:', e);
    return null;
  }
}

/**
 * Send PDF to Telegram (fire-and-forget).
 */
async function sendPdfToTelegram(
  supabase: ReturnType<typeof createClient>,
  ownerUserId: string,
  pdfPath: string,
  fileName: string
) {
  try {
    const { data: telegramUsers } = await supabase
      .from('telegram_users')
      .select('telegram_chat_id, bot_token')
      .eq('user_id', ownerUserId)
      .eq('is_active', true);

    if (!telegramUsers || telegramUsers.length === 0) return;

    const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('documents')
      .download(pdfPath);

    if (downloadError || !fileData) {
      console.error('Failed to download PDF for Telegram:', downloadError);
      return;
    }

    const bytes = new Uint8Array(await fileData.arrayBuffer());

    for (const tgUser of telegramUsers) {
      try {
        const botToken = tgUser.bot_token || TELEGRAM_BOT_TOKEN;
        const formData = new FormData();
        formData.append('chat_id', String(tgUser.telegram_chat_id));
        formData.append('caption', `📄 Новый расходный ордер\n${fileName}`);
        formData.append('document', new Blob([bytes], { type: 'application/pdf' }), fileName);

        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
          method: 'POST',
          body: formData,
        });
        const result = await res.json();
        console.log(`PDF sent to Telegram chat ${tgUser.telegram_chat_id}:`, result.ok);
      } catch (e) {
        console.error(`Failed to send PDF to chat ${tgUser.telegram_chat_id}:`, e);
      }
    }
  } catch (e) {
    console.error('Telegram send error:', e);
  }
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as SubmitPayoutRequest;
    
    const validation = validateInput(body);
    if (!validation.valid) {
      console.log('Validation failed:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!checkRateLimit(body.token)) {
      console.log('Rate limit exceeded for token');
      return new Response(
        JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: linkData, error: linkError } = await supabase
      .from('shared_payout_links')
      .select('id, owner_user_id, is_active, expires_at')
      .eq('token', body.token)
      .single();

    if (linkError || !linkData) {
      console.log('Invalid token:', linkError?.message);
      return new Response(
        JSON.stringify({ error: 'Invalid or expired link' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!linkData.is_active) {
      return new Response(
        JSON.stringify({ error: 'This link is no longer active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This link has expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (body.categoryId) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('categories')
        .select('id')
        .eq('id', body.categoryId)
        .eq('user_id', linkData.owner_user_id)
        .single();

      if (categoryError || !categoryData) {
        console.log('Invalid category for owner');
        return new Response(
          JSON.stringify({ error: 'Invalid category' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    let finalDescription = body.description?.slice(0, MAX_TEXT_LENGTH) || '';
    if (body.imagesSkipped && body.submitterName) {
      const trackingNote = `[Bez załączników - ${body.submitterName}]`;
      finalDescription = finalDescription ? `${finalDescription} ${trackingNote}` : trackingNote;
    }
    
    const { data: txData, error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: linkData.owner_user_id,
        type: 'expense',
        amount: body.amount,
        currency: body.currency,
        category_id: body.categoryId || null,
        description: finalDescription.slice(0, MAX_TEXT_LENGTH) || null,
        date: body.date,
        issued_to: body.issuedTo?.slice(0, MAX_TEXT_LENGTH) || null,
        amount_in_words: body.amountInWords?.slice(0, MAX_TEXT_LENGTH) || null,
        cashier_name: body.departmentName?.slice(0, MAX_TEXT_LENGTH) || null,
      })
      .select('id')
      .single();

    if (txError) {
      console.error('Failed to insert transaction:', txError);
      return new Response(
        JSON.stringify({ error: 'Failed to save transaction' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Enforce max 25 notifications per user (delete oldest beyond limit)
    const { data: existingNotifs } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', linkData.owner_user_id)
      .order('created_at', { ascending: true });

    if (existingNotifs && existingNotifs.length >= 25) {
      const toDeleteIds = existingNotifs.slice(0, existingNotifs.length - 24).map((n: any) => n.id);
      if (toDeleteIds.length > 0) {
        await supabase.from('notifications').delete().in('id', toDeleteIds);
      }
    }

    // Generate PDF on server and upload to Storage
    const pdfPath = await generateAndUploadPdf(supabase, linkData.owner_user_id, txData.id, {
      date: body.date,
      amount: body.amount,
      currency: body.currency,
      issuedTo: body.issuedTo,
      departmentName: body.departmentName,
      description: finalDescription || body.description,
      amountInWords: body.amountInWords,
    });

    // Create notification with pdf_path already attached
    const submitterInfo = body.submitterName || 'Аноним';
    const notificationTitle = 'Новый расходный ордер';
    const notificationMessage = `${submitterInfo} заполнил расходный ордер на ${body.amount} ${body.currency}`;

    const notificationMetadata: Record<string, any> = {
      transaction_id: txData.id,
      amount: body.amount,
      currency: body.currency,
      submitter_name: submitterInfo,
      issued_to: body.issuedTo || null,
    };

    if (pdfPath) {
      notificationMetadata.pdf_path = pdfPath;
    }

    const { error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: linkData.owner_user_id,
        title: notificationTitle,
        message: notificationMessage,
        type: 'payout',
        metadata: notificationMetadata,
      });

    if (notifError) {
      console.error('Failed to create notification:', notifError);
    }

    console.log('Transaction saved successfully:', txData.id, 'pdfPath:', pdfPath);

    // Send PDF to Telegram (fire-and-forget)
    if (pdfPath) {
      const issuedTo = (body.issuedTo || 'dokument').replace(/[^a-zA-Z0-9]/g, '_');
      const fileName = `dowod_wyplaty_${body.date}_${issuedTo}.pdf`;
      sendPdfToTelegram(supabase, linkData.owner_user_id, pdfPath, fileName)
        .catch(e => console.error('Telegram send error:', e));
    }

    return new Response(
      JSON.stringify({ success: true, transactionId: txData.id }),
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
