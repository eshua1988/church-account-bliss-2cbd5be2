import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const VALID_CURRENCIES = ['PLN', 'EUR', 'USD', 'UAH', 'RUB', 'BYN'];
const MAX_SUBMISSIONS_PER_HOUR = 10;
const MAX_TEXT_LENGTH = 500;
const MAX_AMOUNT = 10000000;

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
  decisionNumber?: string;
  bankAccount?: string;
  // Legacy storage-based paths (kept for backward compat)
  tempSigPath?: string;
  tempImgPaths?: string[];
  // New: direct base64 payloads (bypass Storage for anonymous users)
  signatureBase64?: string;
  imagesBase64?: string[];
  language?: string;
  // Client-generated PDF base64 (prevents Cyrillic transliteration from missing font)
  clientPdfBase64?: string;
}

const rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const existing = rateLimitStore.get(token);
  if (!existing || existing.resetTime < now) {
    rateLimitStore.set(token, { count: 1, resetTime: now + hourMs });
    return true;
  }
  if (existing.count >= MAX_SUBMISSIONS_PER_HOUR) return false;
  existing.count++;
  return true;
}

function validateInput(data: SubmitPayoutRequest): { valid: boolean; error?: string } {
  if (!data.token || typeof data.token !== 'string' || data.token.length < 10 || data.token.length > 100) {
    return { valid: false, error: 'Invalid token format' };
  }
  if (typeof data.amount !== 'number' || isNaN(data.amount)) return { valid: false, error: 'Amount must be a number' };
  if (data.amount <= 0) return { valid: false, error: 'Amount must be greater than 0' };
  if (data.amount > MAX_AMOUNT) return { valid: false, error: `Amount cannot exceed ${MAX_AMOUNT}` };
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
  if (dateObj < oneYearAgo) return { valid: false, error: 'Date cannot be more than 1 year in the past' };
  if (dateObj > oneMonthAhead) return { valid: false, error: 'Date cannot be more than 1 month in the future' };
  const textFields: (keyof SubmitPayoutRequest)[] = ['description', 'issuedTo', 'amountInWords'];
  for (const field of textFields) {
    const value = data[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string') return { valid: false, error: `${field} must be a string` };
      if (value.length > MAX_TEXT_LENGTH) return { valid: false, error: `${field} cannot exceed ${MAX_TEXT_LENGTH} characters` };
    }
  }
  if (data.categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.categoryId)) {
    return { valid: false, error: 'Invalid category ID format' };
  }
  return { valid: true };
}

async function sendPushNotification(supabaseUrl: string, serviceKey: string, notificationId: string) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notification_id: notificationId, url: '/church-account-bliss-2cbd5be2/' }),
    });

    if (!response.ok) {
      console.warn('Push notification request failed:', response.status, await response.text());
    }
  } catch (error) {
    console.warn('Push notification request failed:', error);
  }
}

// PDF labels for each language
const pdfLabels: Record<string, Record<string, string>> = {
  pl: {
    org: 'ZBÓR CHRZEŚCIJAN BAPTYSTÓW «BOŻA ŁASKA» W WARSZAWIE',
    title: 'Dowód wypłaty',
    date: 'Data',
    amount: 'Kwota',
    issuedTo: 'Wydano (imię i nazwisko)',
    account: 'Konto do przelewu',
    department: 'Nazwa działu',
    basis: 'Na podstawie',
    amountInWords: 'Kwota słownie',
    cashier: 'Kasjer:',
    cashierSig: 'Podpis kasjera:',
    recipientSig: 'Podpis odbiorcy:',
  },
  ru: {
    org: 'СОБРАНИЕ ХРИСТИАН-БАПТИСТОВ «БОЖЬЯ БЛАГОДАТЬ» В ВАРШАВЕ',
    title: 'Расходный ордер',
    date: 'Дата',
    amount: 'Сумма',
    issuedTo: 'Выдано (ФИО)',
    account: 'Счёт для перевода',
    department: 'Название отдела',
    basis: 'Основание',
    amountInWords: 'Сумма прописью',
    cashier: 'Кассир:',
    cashierSig: 'Подпись кассира:',
    recipientSig: 'Подпись получателя:',
  },
  uk: {
    org: 'ЗІБРАННЯ ХРИСТИЯН-БАПТИСТІВ «БОЖА БЛАГОДАТЬ» У ВАРШАВІ',
    title: 'Видатковий ордер',
    date: 'Дата',
    amount: 'Сума',
    issuedTo: 'Видано (ПІБ)',
    account: 'Рахунок для переказу',
    department: 'Назва відділу',
    basis: 'Підстава',
    amountInWords: 'Сума прописом',
    cashier: 'Касир:',
    cashierSig: 'Підпис касира:',
    recipientSig: 'Підпис отримувача:',
  },
  en: {
    org: 'BAPTIST CHRISTIAN CONGREGATION «GOD\'S GRACE» IN WARSAW',
    title: 'Payment Voucher',
    date: 'Date',
    amount: 'Amount',
    issuedTo: 'Issued to (Full Name)',
    account: 'Bank Account',
    department: 'Department',
    basis: 'Description / Basis',
    amountInWords: 'Amount in words',
    cashier: 'Cashier:',
    cashierSig: 'Cashier signature:',
    recipientSig: 'Recipient signature:',
  },
};

// Load Roboto font: try Storage first, then cache from CDN
async function loadRobotoFont(supabase: ReturnType<typeof createClient>): Promise<string | null> {
  try {
    // Try Storage first (fastest, no external dep)
    const { data: storageFont } = await supabase.storage
      .from('documents')
      .download('fonts/Roboto-Regular.ttf');
    if (storageFont) {
      const buf = await storageFont.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      console.log('Roboto font loaded from Storage');
      return btoa(binary);
    }
  } catch (e) {
    console.log('Font not in Storage, fetching from CDN...');
  }

  // Fetch from CDN and cache to Storage for next time
  try {
    const cdnRes = await fetch(
      'https://cdn.jsdelivr.net/gh/googlefonts/roboto@main/fonts/ttf/Roboto-Regular.ttf'
    );
    if (!cdnRes.ok) throw new Error(`CDN returned ${cdnRes.status}`);
    const buf = await cdnRes.arrayBuffer();
    const bytes = new Uint8Array(buf);
    // Cache to Storage (fire-and-forget)
    supabase.storage.from('documents').upload('fonts/Roboto-Regular.ttf', bytes, {
      contentType: 'font/ttf', upsert: true,
    }).then(() => console.log('Font cached to Storage'))
      .catch(e => console.error('Font cache failed:', e));
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    console.log('Roboto font loaded from CDN');
    return btoa(binary);
  } catch (e) {
    console.error('Failed to load Roboto font from CDN:', e);
    return null;
  }
}

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
    decisionNumber?: string;
    tempSigPath?: string;
    tempImgPaths?: string[];
    signatureBase64?: string;
    imagesBase64?: string[];
    language?: string;
  }
): Promise<string | null> {
  try {
    // Always use Polish labels for PDF headers
    const L = pdfLabels['pl'];

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const leftMargin = 15;
    const rightMargin = 15;
    const tableWidth = pageWidth - leftMargin - rightMargin;
    const labelColWidth = 55;
    const valueColWidth = tableWidth - labelColWidth;
    const rowHeight = 10;
    const cellPadding = 2;

    // Try to load and register Roboto font (Storage → CDN fallback)
    let fontLoaded = false;
    try {
      const fontBase64 = await loadRobotoFont(supabase);
      if (fontBase64) {
        doc.addFileToVFS('Roboto-Regular.ttf', fontBase64);
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.setFont('Roboto');
        fontLoaded = true;
        console.log('Roboto font loaded successfully');
      }
    } catch (e) {
      console.error('Font loading failed, using default:', e);
    }

    // Helper to safely render text (handles encoding)
    const safeText = (text: string): string => {
      if (!text) return '';
      if (fontLoaded) return text; // With custom font, pass as-is
      // Without custom font, transliterate Cyrillic and Polish characters
      return transliterate(text);
    };

    const drawCell = (x: number, y: number, width: number, height: number, text: string, fill = false, bold = false) => {
      if (fill) {
        doc.setFillColor(235, 235, 235);
        doc.rect(x, y, width, height, 'F');
      }
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.3);
      doc.rect(x, y, width, height, 'S');
      doc.setFontSize(9);
      if (bold && fontLoaded) {
        try { doc.setFont('Roboto', 'bold'); } catch { /* noop */ }
      }
      const safeT = safeText(String(text || ''));
      const lines = doc.splitTextToSize(safeT, width - cellPadding * 2);
      doc.text(lines[0] || '', x + cellPadding, y + height / 2 + 3);
      if (bold && fontLoaded) {
        try { doc.setFont('Roboto', 'normal'); } catch { /* noop */ }
      }
    };

    const drawMultilineCell = (x: number, y: number, width: number, height: number, text: string, fill = false) => {
      if (fill) {
        doc.setFillColor(235, 235, 235);
        doc.rect(x, y, width, height, 'F');
      }
      doc.setDrawColor(150, 150, 150);
      doc.setLineWidth(0.3);
      doc.rect(x, y, width, height, 'S');
      doc.setFontSize(9);
      const safeT = safeText(String(text || ''));
      if (safeT) {
        const lines = doc.splitTextToSize(safeT, width - cellPadding * 2);
        doc.text(lines, x + cellPadding, y + 6);
      }
    };

    // Header
    doc.setFontSize(10);
    const orgText = safeText(L.org);
    doc.text(orgText, pageWidth / 2, 18, { align: 'center' });

    doc.setFontSize(15);
    doc.text(safeText(L.title), pageWidth / 2, 28, { align: 'center' });

    // Thin line under title
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.5);
    doc.line(leftMargin, 32, pageWidth - rightMargin, 32);

    let yPos = 38;

    // Date + Amount row side by side
    const halfW = (tableWidth - 5) / 2;
    const dateLabelW = 22;
    const dateValueW = halfW - dateLabelW;
    const amountLabelW = 38;
    const amountValueW = halfW - amountLabelW;

    drawCell(leftMargin, yPos, dateLabelW, rowHeight, safeText(L.date), true, true);
    drawCell(leftMargin + dateLabelW, yPos, dateValueW, rowHeight, data.date);

    const amtX = leftMargin + halfW + 5;
    drawCell(amtX, yPos, amountLabelW, rowHeight, `${safeText(L.amount)} (${data.currency})`, true, true);
    drawCell(amtX + amountLabelW, yPos, amountValueW, rowHeight, `${data.amount}`);

    yPos += rowHeight + 4;

    // Main rows
    const drawRow = (label: string, value: string) => {
      drawCell(leftMargin, yPos, labelColWidth, rowHeight, safeText(label), true, true);
      drawCell(leftMargin + labelColWidth, yPos, valueColWidth, rowHeight, safeText(value));
      yPos += rowHeight;
    };

    drawRow(L.issuedTo, data.issuedTo || '');
    drawRow(L.account, data.decisionNumber || '');
    drawRow(L.department, data.departmentName || '');

    // Basis (multiline)
    const basisText = safeText(data.description || '');
    const basisLines = doc.splitTextToSize(basisText, valueColWidth - cellPadding * 2);
    const basisHeight = Math.max(rowHeight * 2, Math.min(basisLines.length * 5.5 + cellPadding * 2 + 2, 40));
    drawCell(leftMargin, yPos, labelColWidth, basisHeight, safeText(L.basis), true, true);
    drawMultilineCell(leftMargin + labelColWidth, yPos, valueColWidth, basisHeight, data.description || '');
    yPos += basisHeight;

    // Amount in words (multiline)
    const wordsText = safeText(data.amountInWords || '');
    const wordsLines = doc.splitTextToSize(wordsText, valueColWidth - cellPadding * 2);
    const wordsHeight = Math.max(rowHeight * 2, Math.min(wordsLines.length * 5.5 + cellPadding * 2 + 2, 40));
    drawCell(leftMargin, yPos, labelColWidth, wordsHeight, safeText(L.amountInWords), true, true);
    drawMultilineCell(leftMargin + labelColWidth, yPos, valueColWidth, wordsHeight, data.amountInWords || '');
    yPos += wordsHeight + 10;

    // Signatures line
    doc.setFontSize(9);
    doc.setDrawColor(0, 0, 0);
    doc.text(safeText(L.cashier) + ' _______________________________', leftMargin, yPos);
    doc.text(safeText(L.cashierSig) + ' _______________________________', pageWidth / 2 + 5, yPos);

    yPos += 12;

    // Recipient signature box
    doc.setFontSize(10);
    doc.text(safeText(L.recipientSig), leftMargin, yPos);
    yPos += 4;
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.5);
    doc.rect(leftMargin, yPos, 155, 40, 'S');

    // Embed signature: prefer direct base64 payload, fall back to Storage path
    let sigBase64ForEmbed: string | null = null;

    if (data.signatureBase64) {
      // Direct base64 from client (new method — works for anonymous users)
      sigBase64ForEmbed = data.signatureBase64;
      // Also save to permanent Storage path for future reference
      try {
        const sigBytes = Uint8Array.from(atob(data.signatureBase64), c => c.charCodeAt(0));
        await supabase.storage.from('documents').upload(
          `${ownerUserId}/${transactionId}/signature.png`,
          sigBytes,
          { contentType: 'image/png', upsert: true }
        );
      } catch (e) {
        console.warn('Failed to save signature to Storage (non-critical):', e);
      }
    } else {
      // Legacy: download from Storage path
      const sigDownloadPath = data.tempSigPath || `${ownerUserId}/${transactionId}/signature.png`;
      const { data: sigBlob } = await supabase.storage.from('documents').download(sigDownloadPath);
      if (sigBlob) {
        try {
          const sigArrayBuf = await sigBlob.arrayBuffer();
          const sigBytes = new Uint8Array(sigArrayBuf);
          let binary = '';
          for (let i = 0; i < sigBytes.length; i++) binary += String.fromCharCode(sigBytes[i]);
          sigBase64ForEmbed = btoa(binary);
          if (data.tempSigPath) {
            const permanentPath = `${ownerUserId}/${transactionId}/signature.png`;
            await supabase.storage.from('documents').upload(permanentPath, sigBytes, {
              contentType: 'image/png', upsert: true,
            });
            supabase.storage.from('documents').remove([data.tempSigPath])
              .catch(e => console.error('Failed to clean up temp sig:', e));
          }
        } catch (e) {
          console.error('Failed to process signature from Storage:', e);
        }
      }
    }

    if (sigBase64ForEmbed) {
      try {
        doc.addImage(`data:image/png;base64,${sigBase64ForEmbed}`, 'PNG', leftMargin + 5, yPos + 2, 145, 36);
      } catch (e) {
        console.error('Failed to embed signature in PDF:', e);
      }
    }

    // Embed attached images: prefer direct base64 payload, fall back to Storage paths
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    if (data.imagesBase64 && data.imagesBase64.length > 0) {
      // New method: base64 images sent directly from client
      for (let i = 0; i < data.imagesBase64.length; i++) {
        try {
          doc.addPage();
          doc.addImage(`data:image/jpeg;base64,${data.imagesBase64[i]}`, 'JPEG', 5, 5, pageW - 10, pageH - 10);
          // Save to Storage for archival
          try {
            const imgBytes = Uint8Array.from(atob(data.imagesBase64[i]), c => c.charCodeAt(0));
            await supabase.storage.from('documents').upload(
              `${ownerUserId}/${transactionId}/image_${i + 1}.jpg`,
              imgBytes,
              { contentType: 'image/jpeg', upsert: true }
            );
          } catch (e) {
            console.warn(`Failed to archive image ${i + 1} (non-critical):`, e);
          }
        } catch (e) {
          console.error(`Failed to embed base64 image ${i + 1}:`, e);
        }
      }
    } else {
      // Legacy: download from Storage paths
      const tempImgPaths = data.tempImgPaths || [];
      const validImgPaths = tempImgPaths.filter(p => typeof p === 'string' && p.length > 0).slice(0, 10);
      for (let i = 0; i < validImgPaths.length; i++) {
        const imgPath = validImgPaths[i];
        try {
          const { data: imgBlob } = await supabase.storage.from('documents').download(imgPath);
          if (!imgBlob) { console.warn(`Image not found: ${imgPath}`); continue; }
          const imgBuf = await imgBlob.arrayBuffer();
          const imgBytes = new Uint8Array(imgBuf);
          let imgBinary = '';
          for (let j = 0; j < imgBytes.length; j++) imgBinary += String.fromCharCode(imgBytes[j]);
          const imgBase64 = btoa(imgBinary);
          const isJpeg = imgPath.toLowerCase().endsWith('.jpg') || imgPath.toLowerCase().endsWith('.jpeg');
          const fmt = isJpeg ? 'JPEG' : 'PNG';
          const mime = isJpeg ? 'image/jpeg' : 'image/png';
          doc.addPage();
          doc.addImage(`data:${mime};base64,${imgBase64}`, fmt, 5, 5, pageW - 10, pageH - 10);
          console.log(`Embedded image ${i + 1}: ${imgPath}`);
          supabase.storage.from('documents').remove([imgPath])
            .catch(e => console.error(`Failed to clean up temp image ${imgPath}:`, e));
        } catch (e) {
          console.error(`Failed to embed image ${imgPath}:`, e);
        }
      }
    }

    const pdfOutput = doc.output('arraybuffer');
    const pdfBytes = new Uint8Array(pdfOutput);

    // Use simple predictable filename based on date + transaction ID (no Cyrillic in filename)
    const fileName = `payout_${data.date}_${transactionId.slice(0, 8)}.pdf`;
    const storagePath = `${ownerUserId}/${transactionId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });

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

// Transliteration fallback when custom font is not available
function transliterate(text: string): string {
  const map: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh','з':'z',
    'и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r',
    'с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
    'ъ':"'",'ы':'y','ь':"'",'э':'e','ю':'yu','я':'ya',
    'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh','З':'Z',
    'И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O','П':'P','Р':'R',
    'С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts','Ч':'Ch','Ш':'Sh','Щ':'Shch',
    'Ъ':"'",'Ы':'Y','Ь':"'",'Э':'E','Ю':'Yu','Я':'Ya',
    // Ukrainian
    'і':'i','ї':'yi','є':'ye','ґ':'g','І':'I','Ї':'Yi','Є':'Ye','Ґ':'G',
    // Polish
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
    'Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z',
  };
  return text.split('').map(c => map[c] || c).join('');
}

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
      .from('documents').download(pdfPath);

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
          method: 'POST', body: formData,
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
      return new Response(JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json() as SubmitPayoutRequest;

    const validation = validateInput(body);
    if (!validation.valid) {
      console.log('Validation failed:', validation.error);
      return new Response(JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!checkRateLimit(body.token)) {
      return new Response(JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
      return new Response(JSON.stringify({ error: 'Invalid or expired link' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!linkData.is_active) {
      return new Response(JSON.stringify({ error: 'This link is no longer active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'This link has expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (body.categoryId) {
      const { data: categoryData, error: categoryError } = await supabase
        .from('categories').select('id')
        .eq('id', body.categoryId).eq('user_id', linkData.owner_user_id).single();
      if (categoryError || !categoryData) {
        return new Response(JSON.stringify({ error: 'Invalid category' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    let finalDescription = body.description?.slice(0, MAX_TEXT_LENGTH) || '';
    if (body.imagesSkipped && body.submitterName) {
      const trackingNote = `[Bez zalacznikow - ${body.submitterName}]`;
      finalDescription = finalDescription ? `${finalDescription} ${trackingNote}` : trackingNote;
    }

    // Generate a unique folder key (no transaction created automatically)
    const folderKey = crypto.randomUUID();

    // Enforce max 25 notifications per user
    const { data: existingNotifs } = await supabase
      .from('notifications').select('id')
      .eq('user_id', linkData.owner_user_id)
      .neq('type', 'push_subscription')
      .order('created_at', { ascending: true });

    if (existingNotifs && existingNotifs.length >= 25) {
      const toDeleteIds = existingNotifs.slice(0, existingNotifs.length - 24).map((n: any) => n.id);
      if (toDeleteIds.length > 0) {
        await supabase.from('notifications').delete().in('id', toDeleteIds);
      }
    }

    // Validate tempImgPaths
    const tempImgPaths = Array.isArray(body.tempImgPaths)
      ? body.tempImgPaths.filter(p => typeof p === 'string' && p.length < 300).slice(0, 10)
      : [];

    // Generate / upload PDF using folderKey instead of transactionId
    let pdfPath: string | null = null;
    if (body.clientPdfBase64) {
      try {
        const pdfBytes = Uint8Array.from(atob(body.clientPdfBase64), c => c.charCodeAt(0));
        const pdfFileName = `dowod_wyplaty_${body.date}_${folderKey.slice(0, 8)}.pdf`;
        const storagePath = `${linkData.owner_user_id}/${folderKey}/${pdfFileName}`;
        const { error: uploadErr } = await supabase.storage
          .from('documents')
          .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true });
        if (uploadErr) {
          console.error('Client PDF upload failed, falling back to server generation:', uploadErr);
          pdfPath = await generateAndUploadPdf(supabase, linkData.owner_user_id, folderKey, {
            date: body.date, amount: body.amount, currency: body.currency,
            issuedTo: body.issuedTo, departmentName: body.departmentName,
            description: finalDescription || body.description, amountInWords: body.amountInWords,
            decisionNumber: body.decisionNumber, tempSigPath: body.tempSigPath, tempImgPaths,
            signatureBase64: body.signatureBase64, imagesBase64: body.imagesBase64,
          });
        } else {
          pdfPath = storagePath;
          console.log('Client-generated PDF uploaded successfully:', storagePath);
        }
      } catch (e) {
        console.error('Client PDF decode/upload error, falling back to server generation:', e);
        pdfPath = await generateAndUploadPdf(supabase, linkData.owner_user_id, folderKey, {
          date: body.date, amount: body.amount, currency: body.currency,
          issuedTo: body.issuedTo, departmentName: body.departmentName,
          description: finalDescription || body.description, amountInWords: body.amountInWords,
          decisionNumber: body.decisionNumber, tempSigPath: body.tempSigPath, tempImgPaths,
          signatureBase64: body.signatureBase64, imagesBase64: body.imagesBase64,
        });
      }
    } else {
      pdfPath = await generateAndUploadPdf(supabase, linkData.owner_user_id, folderKey, {
        date: body.date, amount: body.amount, currency: body.currency,
        issuedTo: body.issuedTo, departmentName: body.departmentName,
        description: finalDescription || body.description, amountInWords: body.amountInWords,
        decisionNumber: body.decisionNumber, tempSigPath: body.tempSigPath, tempImgPaths,
        signatureBase64: body.signatureBase64, imagesBase64: body.imagesBase64,
      });
    }

    // Create notification — all payout data stored in metadata for manual transaction creation
    const submitterInfo = body.submitterName || 'Аноним';
    const notificationMetadata: Record<string, any> = {
      folder_key: folderKey,
      link_token: body.token,
      amount: body.amount,
      currency: body.currency,
      submitter_name: submitterInfo,
      issued_to: body.issuedTo || null,
      department_name: body.departmentName || null,
      basis: finalDescription || body.description || null,
      amount_in_words: body.amountInWords || null,
      decision_number: body.decisionNumber || null,
      date: body.date || null,
      category_id: body.categoryId || null,
      images_skipped: body.imagesSkipped || false,
      bank_account: body.bankAccount || body.decisionNumber || null,
    };
    if (pdfPath) notificationMetadata.pdf_path = pdfPath;

    const { data: notification, error: notifError } = await supabase
      .from('notifications')
      .insert({
        user_id: linkData.owner_user_id,
        title: 'Новый расходный ордер',
        message: `${submitterInfo} заполнил расходный ордер на ${body.amount} ${body.currency}`,
        type: 'payout',
        metadata: notificationMetadata,
      })
      .select('id')
      .single();

    if (notifError) console.error('Failed to create notification:', notifError);
    if (notification?.id) {
      await sendPushNotification(supabaseUrl, supabaseServiceKey, notification.id);
    }

    console.log('Payout saved (no transaction), folderKey:', folderKey, 'pdfPath:', pdfPath);

    return new Response(
      JSON.stringify({ success: true, folderKey }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
