import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const columnLetter = (index: number) => {
  let value = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    index = Math.floor((index - 1) / 26);
  }
  return value;
};

async function googleToken() {
  const credentials = JSON.parse(Deno.env.get("GOOGLE_SHEETS_CREDENTIALS") || "{}");
  if (!credentials.client_email || !credentials.private_key) throw new Error("Google Sheets credentials are not configured");
  const encode = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const assertion = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), char => char.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(assertion));
  const signed = `${assertion}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const result = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signed}`,
  });
  const payload = await result.json();
  if (!payload.access_token) throw new Error(payload.error_description || "Google authorization failed");
  return payload.access_token as string;
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  try {
    const authHeader = request.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await request.json();
    const values: unknown[][] = Array.isArray(body.values) ? body.values : [];
    if (!values.length) return json({ error: "At least one archive row is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return json({ error: "Unauthorized" }, 401);
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("archived_pdf_spreadsheet_id, archived_pdf_sheet_range, archived_pdf_insert_row")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (profileError || !profile?.archived_pdf_spreadsheet_id || !profile.archived_pdf_sheet_range) {
      return json({ error: "Configure a separate archive PDF sheet in Google Sheets settings first" }, 400);
    }

    const spreadsheetId = String(profile.archived_pdf_spreadsheet_id);
    if (!/^[a-zA-Z0-9_-]{11,99}$/.test(spreadsheetId)) return json({ error: "Invalid spreadsheet ID" }, 400);
    const range = String(profile.archived_pdf_sheet_range);
    const accessToken = await googleToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    const metadataResponse = await fetch(`${base}?fields=sheets.properties`, { headers });
    if (!metadataResponse.ok) return json({ error: "Unable to access the archive spreadsheet" }, 502);
    const metadata = await metadataResponse.json();
    const requestedName = (range.match(/^'?([^'!]+)'?!/) || [])[1];
    const sheet = (metadata.sheets || []).find((item: { properties: { title: string } }) => item.properties.title === requestedName);
    if (!sheet) return json({ error: `Archive sheet \"${requestedName || range}\" was not found` }, 400);
    const startColumn = ((range.match(/!([A-Z]+)/i) || [])[1] || "A").toUpperCase();
    const startColumnIndex = [...startColumn].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
    const insertRow = Math.max(1, Number(profile.archived_pdf_insert_row || 2));
    const sheetId = sheet.properties.sheetId;

    for (const row of [...values].reverse()) {
      const insert = await fetch(`${base}:batchUpdate`, {
        method: "POST", headers,
        body: JSON.stringify({ requests: [{ insertDimension: { range: { sheetId, dimension: "ROWS", startIndex: insertRow - 1, endIndex: insertRow }, inheritFromBefore: false } }] }),
      });
      if (!insert.ok) return json({ error: "Could not insert an archive row" }, 502);
      const endColumn = columnLetter(startColumnIndex + row.length);
      const writeRange = `'${String(sheet.properties.title).replace(/'/g, "''")}'!${startColumn}${insertRow}:${endColumn}${insertRow}`;
      const write = await fetch(`${base}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`, {
        method: "PUT", headers, body: JSON.stringify({ values: [row] }),
      });
      if (!write.ok) return json({ error: "Could not write the archive row" }, 502);
    }
    return json({ success: true });
  } catch (error) {
    console.error("archive-pdf failed", error);
    return json({ error: error instanceof Error ? error.message : "Archive failed" }, 500);
  }
});
