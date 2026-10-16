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

const preferredCurrencyOrder = ["PLN", "USD", "EUR"];
const normaliseCurrency = (currency: string) => {
  const value = currency.trim().toUpperCase();
  if (value === "ZŁ" || value === "ZL") return "PLN";
  if (value === "$") return "USD";
  if (value === "€") return "EUR";
  return value;
};

const currencySort = (left: string, right: string) => {
  const leftIndex = preferredCurrencyOrder.indexOf(left);
  const rightIndex = preferredCurrencyOrder.indexOf(right);
  if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? Infinity : leftIndex) - (rightIndex === -1 ? Infinity : rightIndex);
  return left.localeCompare(right);
};

// Accept exports produced by a cached older browser too.  Such versions put
// every foreign-currency expense into a department column and had no dedicated
// expense columns.  Rebuild the table here, at the final write boundary.
const applyCurrencyColumns = (rawValues: unknown) => {
  if (!Array.isArray(rawValues) || rawValues.length === 0 || !Array.isArray(rawValues[0])) return rawValues;
  const input = rawValues as unknown[][];
  const inputHeaders = input[0].map(value => String(value ?? "").trim());
  const incomeColumns = new Map<number, string | null>();
  const expenseColumns = new Map<number, string>();
  const currencies = new Set<string>();

  inputHeaders.forEach((header, index) => {
    const income = header.match(/^(?:доход(?:ы)?|income)\s*(.*)$/i);
    const expense = header.match(/^(?:расход(?:ы)?|expenses?)\s+(.+)$/i);
    if (income) {
      const currency = normaliseCurrency(income[1]);
      incomeColumns.set(index, currency || null);
      if (currency) currencies.add(currency);
    }
    if (expense) {
      const currency = normaliseCurrency(expense[1]);
      if (currency && currency !== "PLN") {
        expenseColumns.set(index, currency);
        currencies.add(currency);
      }
    }
  });

  // No currency columns means this is not a transactions-export table.
  if (incomeColumns.size === 0) return rawValues;

  input.slice(1).forEach(row => {
    incomeColumns.forEach((currency, index) => {
      const parsed = parseSheetCurrency(row[index]);
      if (parsed) currencies.add(currency || normaliseCurrency(parsed.currency));
    });
    inputHeaders.forEach((_, index) => {
      if (incomeColumns.has(index) || expenseColumns.has(index)) return;
      const parsed = parseSheetCurrency(row[index]);
      if (parsed && normaliseCurrency(parsed.currency) !== "PLN") currencies.add(normaliseCurrency(parsed.currency));
    });
  });

  const orderedCurrencies = [...currencies].filter(Boolean).sort(currencySort);
  if (!orderedCurrencies.includes("PLN")) orderedCurrencies.unshift("PLN");
  const currencyHeaders = orderedCurrencies.flatMap(currency => currency === "PLN"
    ? [`Доход ${currency}`]
    : [`Доход ${currency}`, `Расходы ${currency}`]);
  const currencyColumn = new Map<string, number>();
  currencyHeaders.forEach((header, index) => currencyColumn.set(header, index + 1));
  const categoryIndexes = inputHeaders
    .map((_, index) => index)
    .filter(index => index !== 0 && !incomeColumns.has(index) && !expenseColumns.has(index));
  const categoryHeaders = categoryIndexes.map(index => inputHeaders[index]);
  const categoryStart = currencyHeaders.length + 1;

  const rows = input.slice(1).map(row => {
    const result = new Array(1 + currencyHeaders.length + categoryHeaders.length).fill("");
    result[0] = row[0] ?? "";
    incomeColumns.forEach((declaredCurrency, index) => {
      if (!row[index]) return;
      const parsed = parseSheetCurrency(row[index]);
      const currency = declaredCurrency || normaliseCurrency(parsed?.currency || "");
      const target = currencyColumn.get(`Доход ${currency}`);
      if (target !== undefined) result[target] = row[index];
    });
    expenseColumns.forEach((currency, index) => {
      const target = currencyColumn.get(`Расходы ${currency}`);
      if (target !== undefined && row[index]) result[target] = row[index];
    });
    categoryIndexes.forEach((sourceIndex, categoryIndex) => {
      if (!row[sourceIndex]) return;
      const parsed = parseSheetCurrency(row[sourceIndex]);
      const currency = normaliseCurrency(parsed?.currency || "PLN");
      const foreignExpense = currency !== "PLN" ? currencyColumn.get(`Расходы ${currency}`) : undefined;
      if (foreignExpense !== undefined) result[foreignExpense] = row[sourceIndex];
      else result[categoryStart + categoryIndex] = row[sourceIndex];
    });
    return result;
  });

  return [["Дата", ...currencyHeaders, ...categoryHeaders], ...rows];
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

const columnLetter = (index: number) => {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

// A saved range such as "Лист31!B:Z" is a starting position, not a hard
// schema limit: transaction exports add department and currency columns.
// Expand the end column before writing so a new column (AA, AB, ...) cannot
// make the whole top-level synchronization fail.
const expandRangeColumns = (range: string, columnCount: number) =>
  range.replace(/([A-Z]+):([A-Z]+)$/i, (_match, startColumn: string) => {
    const startIndex = columnIndex(startColumn);
    return `${startColumn}:${columnLetter(startIndex + Math.max(columnCount, 1) - 1)}`;
  });

type RangePart = { range: string; startColumnIndex: number; columnCount: number; valueOffset: number };

// A semicolon separates destination column blocks.  For example, B:F;I:Z
// writes the first five exported fields into B:F and continues at I, leaving
// G:H completely untouched.  Google Sheets' A1 API accepts one range per
// request, so the table is split here instead of filling the skipped columns
// with empty values.
const splitRangeParts = (range: string, dataWidth: number): RangePart[] => {
  const prefixMatch = range.match(/^(.*!)(.+)$/);
  const prefix = prefixMatch?.[1] || "";
  const rawParts = (prefixMatch?.[2] || range).split(";").map(part => part.trim()).filter(Boolean);
  if (rawParts.length === 0) return [];

  let valueOffset = 0;
  return rawParts.flatMap((raw, partIndex) => {
    const match = raw.match(/^([A-Z]+)(\d+)?(?::([A-Z]+)?(\d+)?)?$/i);
    if (!match) return [];
    const start = match[1].toUpperCase();
    const startColumnIndex = columnIndex(start);
    const originalEnd = (match[3] || start).toUpperCase();
    const originalWidth = columnIndex(originalEnd) - startColumnIndex + 1;
    // Keep the existing flexible export behaviour: if new categories make the
    // table wider than the configured blocks, extend only the final block.
    const remaining = Math.max(dataWidth - valueOffset, 0);
    const columnCount = partIndex === rawParts.length - 1
      ? Math.max(originalWidth, remaining)
      : originalWidth;
    const end = columnLetter(startColumnIndex + columnCount - 1);
    const startRow = match[2] || "";
    const endRow = match[4] || "";
    const partRange = `${prefix}${start}${startRow}:${end}${endRow}`;
    const result = { range: partRange, startColumnIndex, columnCount, valueOffset };
    valueOffset += columnCount;
    return [result];
  });
};

const valuesForRangePart = (values: unknown[][], part: RangePart) =>
  values.map(row => row.slice(part.valueOffset, part.valueOffset + part.columnCount));

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
      const values = applyCurrencyColumns(body.values || []);
      const metadataResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
      if (!metadataResponse.ok) return json({ error: "Google Sheets metadata failed" }, 500);
      const metadata = await metadataResponse.json();
      const sheet = configuredSheet(metadata, range);
      if (typeof sheet?.properties?.sheetId !== "number") return json({ error: "Google Sheet was not found" }, 500);

      const dataWidth = Math.max(...values.map((row: unknown[]) => row.length), 1);
      const rangeParts = splitRangeParts(range, dataWidth);
      if (!rangeParts.length) return json({ error: "Invalid Google Sheets range" }, 400);

      // Old exported notes must not survive a new full export, even if rows or
      // categories have moved.  Each configured block is handled separately
      // so columns omitted with a semicolon are never cleared or written.
      const clearNotesResponse = await fetch(`${base}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: rangeParts.map(part => ({ repeatCell: {
          range: rangeBounds(sheet.properties.sheetId, part.range, sheet),
          cell: { note: "" },
          fields: "note",
        } })) }),
      });
      if (!clearNotesResponse.ok) return json({ error: "Google Sheets note cleanup failed" }, 500);

      for (const part of rangeParts) {
        const clearResponse = await fetch(`${base}/values/${encodeURIComponent(part.range)}:clear`, { method: "POST", headers, body: "{}" });
        if (!clearResponse.ok) return json({ error: "Google Sheets range cleanup failed" }, 500);
        if (part.valueOffset >= dataWidth) continue;
        const response = await fetch(`${base}/values/${encodeURIComponent(part.range)}?valueInputOption=USER_ENTERED`, {
          method: "PUT", headers, body: JSON.stringify({ values: valuesForRangePart(values, part) }),
        });
        if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets write failed" }, 500);
      }
      // Keep the export limited to its configured range. In particular, do not
      // create or clear a separate currency-summary block beside the table:
      // protected columns there made otherwise successful exports appear failed.
      return json({ success: true });
    }
    if (archive) {
      const sourceRows: unknown[][] = Array.isArray(body.values) ? body.values : [];
      const currencies = [...new Set([
        "PLN",
        ...sourceRows.flatMap(row => [parseSheetCurrency(row[1])?.currency, parseSheetCurrency(row[3])?.currency])
          .filter((currency): currency is string => Boolean(currency))
          .map(normaliseCurrency),
      ])].sort(currencySort);
      const departments = [...new Set(sourceRows.map(row => String(row[2] || "").trim()).filter(Boolean))];
      const currencyColumns = currencies.flatMap(currency => currency === "PLN"
        ? [{ currency, type: "income" as const, header: `Доход ${currency}` }]
        : [
            { currency, type: "income" as const, header: `Доход ${currency}` },
            { currency, type: "expense" as const, header: `Расходы ${currency}` },
          ]);
      const currencyColumn = new Map(currencyColumns.map((column, index) => [`${column.type}:${column.currency}`, index + 1]));
      const departmentStart = currencyColumns.length + 1;
      const headersRow = ["Дата", ...currencyColumns.map(column => column.header), ...departments];
      type ArchiveRow = { cells: Array<string | number>; notes: Array<{ col: number; text: string }>; currencies: Array<{ col: number; currency: string }> };
      type SourceArchiveRow = { date: string; income: SheetCurrency | null; expense: SheetCurrency | null; targetColumn: number; basis: string; issuedTo: string };
      const byMonth = new Map<string, SourceArchiveRow[]>();

      // Only a Dowód wpłaty (income) owns a date in the archive table.
      // Expenses are grouped below the income rows of the same month without a
      // date, so they cannot be mistaken for a payment receipt on that day.
      sourceRows.forEach(row => {
        const date = String(row[0] || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
        const income = parseSheetCurrency(row[1]);
        const expense = parseSheetCurrency(row[3]);
        const departmentIndex = departments.indexOf(String(row[2] || "").trim());
        const incomeCurrency = normaliseCurrency(income?.currency || "");
        const expenseCurrency = normaliseCurrency(expense?.currency || "");
        const targetColumn = income
          ? currencyColumn.get(`income:${incomeCurrency}`) ?? -1
          : expenseCurrency && expenseCurrency !== "PLN"
            ? currencyColumn.get(`expense:${expenseCurrency}`) ?? -1
            : departmentIndex !== -1
              ? departmentStart + departmentIndex
              : -1;
        if (targetColumn === -1) return;
        const parsed = {
          date,
          income,
          expense,
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
        cells: [date, ...new Array(currencyColumns.length + departments.length).fill("")],
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
      const archiveRangeParts = splitRangeParts(range, headersRow.length);
      if (!archiveRangeParts.length) return json({ error: "Invalid Google Sheets range" }, 400);
      const clearArchiveNotes = await fetch(`${base}:batchUpdate`, { method: "POST", headers, body: JSON.stringify({ requests: archiveRangeParts.map(part => ({ repeatCell: {
        range: rangeBounds(archiveSheet.properties.sheetId, part.range, archiveSheet),
        cell: { note: "" }, fields: "note",
      } })) }) });
      if (!clearArchiveNotes.ok) return json({ error: "Google Sheets archive note cleanup failed" }, 500);
      for (const part of archiveRangeParts) {
        const clearResponse = await fetch(`${base}/values/${encodeURIComponent(part.range)}:clear`, { method: "POST", headers, body: "{}" });
        if (!clearResponse.ok) return json({ error: "Google Sheets range cleanup failed" }, 500);
        if (part.valueOffset >= headersRow.length) continue;
        const response = await fetch(`${base}/values/${encodeURIComponent(part.range)}?valueInputOption=USER_ENTERED`, {
          method: "PUT", headers, body: JSON.stringify({ values: valuesForRangePart(table, part) }),
        });
        if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets export failed" }, 500);
      }
      const bounds = rangeBounds(archiveSheet.properties.sheetId, archiveRangeParts[0].range, archiveSheet);
      const physicalColumn = (logicalColumn: number) => {
        const part = archiveRangeParts.find(candidate => logicalColumn >= candidate.valueOffset && logicalColumn < candidate.valueOffset + candidate.columnCount);
        return part ? part.startColumnIndex + logicalColumn - part.valueOffset : 0;
      };

      // Remove separators left by a previous layout, then draw a thick line
      // before each new month. Dates remain only on income rows.
      if (archiveRows.length > 0) {
        const dataStartRow = bounds.startRowIndex + 1; // skip the header
        const borderRequests = [
          ...archiveRangeParts.map(part => ({
            repeatCell: {
              range: { sheetId: archiveSheet.properties.sheetId, startRowIndex: dataStartRow, endRowIndex: bounds.endRowIndex, startColumnIndex: part.startColumnIndex, endColumnIndex: part.startColumnIndex + part.columnCount },
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
          })),
          ...monthSeparatorRowIndexes.flatMap(rowOffset => archiveRangeParts.map(part => ({
            repeatCell: {
              range: { sheetId: archiveSheet.properties.sheetId, startRowIndex: bounds.startRowIndex + rowOffset, endRowIndex: bounds.startRowIndex + rowOffset + 1, startColumnIndex: part.startColumnIndex, endColumnIndex: part.startColumnIndex + part.columnCount },
              cell: { userEnteredFormat: { borders: { top: { style: "SOLID_THICK" } } } },
              fields: "userEnteredFormat.borders.top",
            },
          }))),
          ...archiveRows.flatMap((row, rowOffset) => row.currencies.map(currency => ({
            repeatCell: {
              range: {
                sheetId: archiveSheet.properties.sheetId,
                startRowIndex: dataStartRow + rowOffset,
                endRowIndex: dataStartRow + rowOffset + 1,
                startColumnIndex: physicalColumn(currency.col),
                endColumnIndex: physicalColumn(currency.col) + 1,
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
          range: { sheetId: archiveSheet.properties.sheetId, startRowIndex: bounds.startRowIndex + rowOffset + 1, endRowIndex: bounds.startRowIndex + rowOffset + 2, startColumnIndex: physicalColumn(note.col), endColumnIndex: physicalColumn(note.col) + 1 },
          cell: { note: note.text },
          fields: "note",
        },
      })));
      if (noteRequests.length) {
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
