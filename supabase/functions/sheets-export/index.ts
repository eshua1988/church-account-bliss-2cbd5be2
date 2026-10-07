import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const transactionRangeStartingAtA = (range: string) => range.replace(/(^|!)[A-Z]+(?=:)/i, "$1A");

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
      if (error || !exportTarget || exportTarget.export_type !== (archive ? "pdf" : "transactions")) return json({ error: "Google Sheets export was not found" }, 404);
      spreadsheetId = String(exportTarget.spreadsheet_id || "");
      savedRange = String(exportTarget.sheet_range || "");
    } else {
      // Backward-compatible fallback for the original two profile settings.
      const { data: profile, error: profileError } = await supabase.from("profiles").select("spreadsheet_id, sheet_range, archived_pdf_spreadsheet_id, archived_pdf_sheet_range").eq("user_id", auth.user.id).maybeSingle();
      if (profileError || !profile) return json({ error: "Google Sheets settings not found" }, 400);
      spreadsheetId = String(archive ? profile.archived_pdf_spreadsheet_id || "" : profile.spreadsheet_id || "");
      savedRange = String(archive ? profile.archived_pdf_sheet_range || "" : profile.sheet_range || "");
    }
    // Transaction export is a complete table, so it always begins in column A.
    // This also repairs older settings that accidentally started it in column B.
    const range = archive ? savedRange : transactionRangeStartingAtA(savedRange);
    if (!spreadsheetId || !range) return json({ error: "Configure the export sheet first" }, 400);
    const accessToken = await googleToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    if (body.action === "write") {
      const metadataResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
      if (!metadataResponse.ok) return json({ error: "Google Sheets metadata failed" }, 500);
      const metadata = await metadataResponse.json();
      const requestedSheetName = (range.match(/^'?([^'!]+)'?!/) || [])[1];
      const sheet = (metadata.sheets || []).find((item: { properties?: { title?: string } }) => item.properties?.title === requestedSheetName) || metadata.sheets?.[0];
      if (typeof sheet?.properties?.sheetId !== "number") return json({ error: "Google Sheet was not found" }, 500);

      // Old exported notes must not survive a new full export, even if rows or
      // categories have moved. Clear notes across the export sheet first.
      const columnCount = Math.max(Number(sheet.properties.gridProperties?.columnCount || 0), 1);
      const clearNotesResponse = await fetch(`${base}:batchUpdate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ requests: [{ repeatCell: {
          range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: columnCount },
          cell: { note: "" },
          fields: "note",
        } }] }),
      });
      if (!clearNotesResponse.ok) return json({ error: "Google Sheets note cleanup failed" }, 500);

      await fetch(`${base}/values/${encodeURIComponent(range)}:clear`, { method: "POST", headers, body: "{}" });
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: body.values || [] }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets write failed" }, 500);
      return json({ success: true });
    }
    if (archive) {
      const sourceRows: string[][] = Array.isArray(body.values) ? body.values : [];
      const currencies = [...new Set(sourceRows.map(row => String(row[1] || "").trim().split(/\s+/).at(-1) || "").filter(Boolean))];
      const departments = [...new Set(sourceRows.map(row => String(row[2] || "").trim()).filter(Boolean))];
      const headersRow = ["Дата", ...currencies.map(currency => `Доход ${currency}`), ...departments];
      type ArchiveRow = { cells: string[]; notes: Array<{ col: number; text: string }> };
      const rowsByDate = new Map<string, ArchiveRow[]>();

      // A day may share a row only while every value goes to its own cell.
      // When a currency/department cell is already occupied, add another row
      // and repeat the date instead of combining amounts in one cell.
      sourceRows.forEach(row => {
        const date = String(row[0] || "");
        if (!date) return;
        const income = String(row[1] || "").trim();
        const expense = String(row[3] || "").trim();
        const currency = income ? income.split(/\s+/).at(-1) || "" : "";
        const incomeAmount = income.replace(/\s+[A-Za-z]{3}$/, "");
        const incomeIndex = currencies.indexOf(currency);
        const departmentIndex = departments.indexOf(String(row[2] || "").trim());
        const targetColumn = incomeIndex !== -1
          ? 1 + incomeIndex
          : departmentIndex !== -1
            ? 1 + currencies.length + departmentIndex
            : -1;
        if (targetColumn === -1) return;

        const dateRows = rowsByDate.get(date) || [];
        let archiveRow = dateRows.find(candidate => !candidate.cells[targetColumn]);
        if (!archiveRow) {
          archiveRow = { cells: [date, ...new Array(currencies.length + departments.length).fill("")], notes: [] };
          dateRows.push(archiveRow);
        }

        archiveRow.cells[targetColumn] = incomeIndex !== -1 ? incomeAmount : expense;
        const basis = String(row[4] || "").trim();
        if (departmentIndex !== -1 && basis) archiveRow.notes.push({ col: targetColumn, text: basis });
        rowsByDate.set(date, dateRows);
      });
      const archiveRows = [...rowsByDate.values()].flat();
      const table = [headersRow, ...archiveRows.map(row => row.cells)];
      await fetch(`${base}/values/${encodeURIComponent(range)}:clear`, { method: "POST", headers, body: "{}" });
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: table }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets export failed" }, 500);

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
        const requestedSheetName = (range.match(/^'?([^'!]+)'?!/) || [])[1];
        const sheet = (meta.sheets || []).find((item: { properties?: { title?: string } }) => item.properties?.title === requestedSheetName) || meta.sheets?.[0];
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
