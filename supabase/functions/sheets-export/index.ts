import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type GoogleSheet = { properties?: { title?: string; sheetId?: number; gridProperties?: { rowCount?: number; columnCount?: number } } };

type SheetCurrency = { amount: number; currency: string };

const parseSheetCurrency = (raw: unknown): SheetCurrency | null => {
  const match = String(raw ?? "").trim().match(/^(-?[\d\s]+(?:[.,]\d+)?)\s*([^\s]+)?$/);
  if (!match) return null;
  const amount = Number(match[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: String(match[2] || "").trim().toUpperCase() };
};

// Google Sheets receives actual numbers; the pattern selects its native
// currency renderer instead of putting a currency code into cell text.
const currencyPattern = (currency: string) => ({
  PLN: '#,##0.00 [$zł-pl-PL]',
  USD: '[$$-en-US]#,##0.00',
  EUR: '[$€-x-euro2] #,##0.00',
  UAH: '[$₴-uk-UA] #,##0.00',
}[currency] || '#,##0.00');

const configuredSheet = (metadata: { sheets?: GoogleSheet[] }, range: string) => {
  const requestedName = (range.match(/^'?([^'!]+)'?!/) || [])[1];
  // A range without a tab name deliberately targets the first tab, matching
  // Google Sheets' A1 notation.  A named tab must exist: silently falling
  // back to another tab can overwrite unrelated data.
  return requestedName
    ? (metadata.sheets || []).find((item) => item.properties?.title === requestedName)
    : metadata.sheets?.[0];
};

const columnIndex = (column: string) => [...column.toUpperCase()].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const rangeBounds = (sheetId: number, range: string, sheet: GoogleSheet) => {
  const a1 = range.includes("!") ? range.slice(range.indexOf("!") + 1) : range;
  const match = a1.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
  const maxRows = Math.max(Number(sheet.properties?.gridProperties?.rowCount || 0), 1000);
  const maxColumns = Math.max(Number(sheet.properties?.gridProperties?.columnCount || 0), 1);
  if (!match) return { sheetId, startRowIndex: 0, endRowIndex: maxRows, startColumnIndex: 0, endColumnIndex: maxColumns };
  const startColumnIndex = columnIndex(match[1]);
  const endColumnIndex = match[3] ? columnIndex(match[3]) + 1 : startColumnIndex + 1;
  return {
    sheetId,
    startRowIndex: match[2] ? Number(match[2]) - 1 : 0,
    endRowIndex: match[4] ? Number(match[4]) : maxRows,
    startColumnIndex,
    endColumnIndex,
  };
};

async function googleToken() {
  const credentials = JSON.parse(Deno.env.get("GOOGLE_SHEETS_CREDENTIALS") || "{}");
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Sheets credentials are not configured");
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: credentials.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const jwt = `${input}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` });
  const data = await response.json();
  if (!data.access_token) throw new Error(data.error_description || data.error || "Google authorization failed");
  return data.access_token as string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const body = await req.json();
    const token = String(body.accessToken || "");
    if (!token) return json({ error: "Unauthorized" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Unauthorized" }, 401);
    const archive = body.action === "archive_pdf_export";
    const expectedExportType = archive ? "pdf" : "transactions";
    const requestedExportId = String(body.exportId || "");
    let spreadsheetId = "";
    let savedRange = "";
    if (requestedExportId) {
      const { data: exportTarget, error } = await supabase
        .from("google_sheet_exports")
        .select("spreadsheet_id, sheet_range, export_type")
        .eq("id", requestedExportId)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (error || !exportTarget || exportTarget.export_type !== expectedExportType) return json({ error: "Google Sheets export was not found" }, 404);
      spreadsheetId = String(exportTarget.spreadsheet_id || "");
      savedRange = String(exportTarget.sheet_range || "");
    } else {
      // Backward-compatible fallback for the original two profile settings.
      const { data: profile, error: profileError } = await supabase.from("profiles").select("spreadsheet_id, sheet_range, archived_pdf_spreadsheet_id, archived_pdf_sheet_range").eq("user_id", auth.user.id).maybeSingle();
      if (profileError || !profile) return json({ error: "Google Sheets settings not found" }, 400);
      spreadsheetId = String(archive ? profile.archived_pdf_spreadsheet_id || "" : profile.spreadsheet_id || "");
      savedRange = String(archive ? profile.archived_pdf_sheet_range || "" : profile.sheet_range || "");
    }
    // Both export types honour the exact range configured for that export.
    const range = savedRange;
    if (!spreadsheetId || !range) return json({ error: "Configure the export sheet first" }, 400);
    const accessToken = await googleToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    if (body.action === "write") {
      const metadataResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
      if (!metadataResponse.ok) return json({ error: "Google Sheets metadata failed" }, 500);
      const metadata = await metadataResponse.json();
      const sheet = configuredSheet(metadata, range);
      if (typeof sheet?.properties?.sheetId !== "number") return json({ error: "Google Sheet was not found" }, 500);

      // Old exported notes must not survive a new full export, even if rows or
      // categories have moved. Clear notes across the export sheet first.
      const clearNotesResponse = await fetch(`${base}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: [{ repeatCell: {
          range: rangeBounds(sheet.properties.sheetId, range, sheet),
          cell: { note: "" },
          fields: "note",
        } }] }),
      });
      if (!clearNotesResponse.ok) return json({ error: "Google Sheets note cleanup failed" }, 500);

      const clearResponse = await fetch(`${base}/values/${encodeURIComponent(range)}:clear`, { method: "POST", headers, body: "{}" });
      if (!clearResponse.ok) return json({ error: "Google Sheets range cleanup failed" }, 500);
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: body.values || [] }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets write failed" }, 500);
      return json({ success: true });
    }
    if (archive) {
      const sourceRows: unknown[][] = Array.isArray(body.values) ? body.values : [];
      const currencies = [...new Set(sourceRows.map(row => parseSheetCurrency(row[1])?.currency || "").filter(Boolean))];
      const departments = [...new Set(sourceRows.map(row => String(row[2] || "").trim()).filter(Boolean))];
      const headersRow = ["Дата", ...currencies.map(currency => `Доход ${currency}`), ...departments];
      type ArchiveRow = { cells: Array<string | number>; notes: Array<{ col: number; text: string }>; currencies: Array<{ col: number; currency: string }> };
      type SourceArchiveRow = { date: string; income: SheetCurrency | null; expense: SheetCurrency | null; currency: string; incomeIndex: number; departmentIndex: number; targetColumn: number; basis: string; issuedTo: string };
      const byMonth = new Map<string, SourceArchiveRow[]>();

      // Only a Dowód wpłaty (income) owns a date in the archive table.
      // Expenses are grouped below the income rows of the same month without a
      // date, so they cannot be mistaken for a payment receipt on that day.
      sourceRows.forEach(row => {
        const date = String(row[0] || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const income = parseSheetCurrency(row[1]);
        const expense = parseSheetCurrency(row[3]);
        const currency = income?.currency || "";
        const incomeIndex = currencies.indexOf(currency);
        const departmentIndex = departments.indexOf(String(row[2] || "").trim());
        const targetColumn = incomeIndex !== -1
          ? 1 + incomeIndex
          : departmentIndex !== -1
            ? 1 + currencies.length + departmentIndex
            : -1;
        if (targetColumn === -1) return;
        const parsed = {
          date,
          income,
          expense,
          currency,
          incomeIndex,
          departmentIndex,
          targetColumn,
          basis: String(row[4] || "").trim(),
          issuedTo: String(row[5] || "").trim(),
        };
        const month = date.slice(0, 7);
        const monthRows = byMonth.get(month) || [];
        monthRows.push(parsed);
        byMonth.set(month, monthRows);
      });

      const archiveRows: ArchiveRow[] = [];
      const monthSeparatorRowIndexes: number[] = [];
      const makeRow = (date = ""): ArchiveRow => ({
        cells: [date, ...new Array(currencies.length + departments.length).fill("")],
        notes: [],
        currencies: [],
      });

      [...byMonth.keys()].sort((left, right) => right.localeCompare(left)).forEach((month, monthIndex) => {
        if (monthIndex > 0) monthSeparatorRowIndexes.push(archiveRows.length + 1);
        const monthRows = byMonth.get(month) || [];
        const incomeRows = monthRows.filter(row => Boolean(row.income)).sort((left, right) => right.date.localeCompare(left.date));
        const expenseRows = monthRows.filter(row => !row.income && Boolean(row.expense)).sort((left, right) => right.date.localeCompare(left.date));
        const incomeArchiveRows: ArchiveRow[] = [];
        const expenseArchiveRows: ArchiveRow[] = [];

        // Values with the same receipt date may share a row only if they use
        // different currency columns. A collision repeats that receipt date.
        incomeRows.forEach(row => {
          let archiveRow = incomeArchiveRows.find(candidate => candidate.cells[0] === row.date && !candidate.cells[row.targetColumn]);
          if (!archiveRow) {
            archiveRow = makeRow(row.date);
            incomeArchiveRows.push(archiveRow);
          }
          archiveRow.cells[row.targetColumn] = row.income!.amount;
          archiveRow.currencies.push({ col: row.targetColumn, currency: row.income!.currency });
        });

        // Department expenses are packed into date-free rows for this month.
        expenseRows.forEach(row => {
          let archiveRow = expenseArchiveRows.find(candidate => !candidate.cells[row.targetColumn]);
          if (!archiveRow) {
            archiveRow = makeRow();
            expenseArchiveRows.push(archiveRow);
          }
          archiveRow.cells[row.targetColumn] = row.expense!.amount;
          archiveRow.currencies.push({ col: row.targetColumn, currency: row.expense!.currency });
          // Keep the accounting reason readable and add the person who received
          // the payment at the end, without adding another visible table column.
          const note = [row.basis, row.issuedTo ? `(${row.issuedTo})` : ""].filter(Boolean).join(" ");
          if (note) archiveRow.notes.push({ col: row.targetColumn, text: note });
        });

        archiveRows.push(...incomeArchiveRows, ...expenseArchiveRows);
      });
      const table = [headersRow, ...archiveRows.map(row => row.cells)];
      // PDF exports replace the complete archive table. Remove notes from the
      // previous period before writing, otherwise notes on cleared rows remain.
      const archiveMetaResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
      if (!archiveMetaResponse.ok) return json({ error: "Could not resolve the archive sheet for note cleanup" }, 500);
      const archiveMeta = await archiveMetaResponse.json();
      const archiveSheet = configuredSheet(archiveMeta, range);
      if (typeof archiveSheet?.properties?.sheetId !== "number") return json({ error: "Archive sheet was not found for note cleanup" }, 500);
      const clearArchiveNotes = await fetch(`${base}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: [{ repeatCell: {
        range: rangeBounds(archiveSheet.properties.sheetId, range, archiveSheet),
        cell: { note: "" }, fields: "note",
      } }] }) });
      if (!clearArchiveNotes.ok) return json({ error: "Google Sheets archive note cleanup failed" }, 500);
      const clearResponse = await fetch(`${base}/values/${encodeURIComponent(range)}:clear`, { method: "POST", headers, body: "{}" });
      if (!clearResponse.ok) return json({ error: "Google Sheets range cleanup failed" }, 500);
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: table }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets export failed" }, 500);

      // Remove separators left by a previous layout, then draw a thick line
      // before each new month. Dates remain only on income rows.
      if (archiveRows.length > 0) {
        const bounds = rangeBounds(archiveSheet.properties.sheetId, range, archiveSheet);
        const dataStartRow = bounds.startRowIndex + 1; // skip the header
        const dataEndColumn = bounds.startColumnIndex + headersRow.length;
        const borderRequests = [
          {
            repeatCell: {
              range: { sheetId: archiveSheet.properties.sheetId, startRowIndex: dataStartRow, endRowIndex: bounds.endRowIndex, startColumnIndex: bounds.startColumnIndex, endColumnIndex: dataEndColumn },
              // Explicit thin borders keep ordinary cells visible even when the
              // sheet's default gridlines are disabled. Background colours and
              // other template formatting remain unchanged.
              cell: { userEnteredFormat: { borders: {
                top: { style: "SOLID", color: { red: 0.72, green: 0.72, blue: 0.72 } },
                bottom: { style: "SOLID", color: { red: 0.72, green: 0.72, blue: 0.72 } },
                left: { style: "SOLID", color: { red: 0.72, green: 0.72, blue: 0.72 } },
                right: { style: "SOLID", color: { red: 0.72, green: 0.72, blue: 0.72 } },
              } } },
              fields: "userEnteredFormat.borders",
            },
          },
          ...monthSeparatorRowIndexes.map(rowOffset => ({
            repeatCell: {
              range: { sheetId: archiveSheet.properties.sheetId, startRowIndex: bounds.startRowIndex + rowOffset, endRowIndex: bounds.startRowIndex + rowOffset + 1, startColumnIndex: bounds.startColumnIndex, endColumnIndex: dataEndColumn },
              cell: { userEnteredFormat: { borders: { top: { style: "SOLID_THICK" } } } },
              fields: "userEnteredFormat.borders.top",
            },
          })),
          ...archiveRows.flatMap((row, rowOffset) => row.currencies.map(currency => ({
            repeatCell: {
              range: {
                sheetId: archiveSheet.properties.sheetId,
                startRowIndex: dataStartRow + rowOffset,
                endRowIndex: dataStartRow + rowOffset + 1,
                startColumnIndex: bounds.startColumnIndex + currency.col,
                endColumnIndex: bounds.startColumnIndex + currency.col + 1,
              },
              cell: { userEnteredFormat: { numberFormat: { type: "CURRENCY", pattern: currencyPattern(currency.currency) } } },
              fields: "userEnteredFormat.numberFormat",
            },
          }))),
        ];
        const borderResponse = await fetch(`${base}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: borderRequests }) });
        if (!borderResponse.ok) return json({ error: "Google Sheets month separator formatting failed" }, 500);
      }

      const noteRequests = archiveRows.flatMap((row, rowOffset) => row.notes.map(note => ({
        repeatCell: {
          range: { sheetId: -1, startRowIndex: rowOffset + 1, endRowIndex: rowOffset + 2, startColumnIndex: note.col, endColumnIndex: note.col + 1 },
          cell: { note: note.text },
          fields: "note",
        },
      })));
      if (noteRequests.length) {
        const metaResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
        if (!metaResponse.ok) return json({ error: "Could not resolve the archive sheet for notes" }, 500);
        const meta = await metaResponse.json();
        const sheet = configuredSheet(meta, range);
        if (typeof sheet?.properties?.sheetId !== "number") return json({ error: "Archive sheet was not found for notes" }, 500);

        const rangeStart = range.match(/!([A-Z]+)(\d+)?/i);
        const startColumn = (rangeStart?.[1] || "A").toUpperCase().split("").reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
        const startRow = Math.max(Number(rangeStart?.[2] || 1) - 1, 0);
        noteRequests.forEach(request => {
          const cellRange = (request.repeatCell as { range: { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number; endColumnIndex: number } }).range;
          cellRange.sheetId = sheet.properties.sheetId;
          cellRange.startRowIndex += startRow;
          cellRange.endRowIndex += startRow;
          cellRange.startColumnIndex += startColumn;
          cellRange.endColumnIndex += startColumn;
        });

        // The note is attached to the expense amount itself, so it remains
        // visible through Google Sheets' "Insert note" interface.
        const notesResponse = await fetch(`${base}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: noteRequests }) });
        if (!notesResponse.ok) return json({ error: (await notesResponse.json()).error?.message || "Google Sheets notes failed" }, 500);
      }
      return json({ success: true });
    }
    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Export failed" }, 500);
  }
});
