import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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
    const { data: profile, error: profileError } = await supabase.from("profiles").select("spreadsheet_id, sheet_range, archived_pdf_spreadsheet_id, archived_pdf_sheet_range").eq("user_id", auth.user.id).maybeSingle();
    if (profileError || !profile) return json({ error: "Google Sheets settings not found" }, 400);
    const archive = body.action === "archive_pdf_export";
    const spreadsheetId = String(archive ? profile.archived_pdf_spreadsheet_id || "" : profile.spreadsheet_id || "");
    const range = String(archive ? profile.archived_pdf_sheet_range || "" : profile.sheet_range || "");
    if (!spreadsheetId || !range) return json({ error: "Configure the export sheet first" }, 400);
    const accessToken = await googleToken();
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
    if (body.action === "write") {
      await fetch(`${base}/values/${encodeURIComponent(range)}:clear`, { method: "POST", headers, body: "{}" });
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { method: "PUT", headers, body: JSON.stringify({ values: body.values || [] }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets write failed" }, 500);
      return json({ success: true });
    }
    if (archive) {
      const response = await fetch(`${base}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, { method: "POST", headers, body: JSON.stringify({ values: body.values || [] }) });
      if (!response.ok) return json({ error: (await response.json()).error?.message || "Google Sheets export failed" }, 500);
      return json({ success: true });
    }
    return json({ error: "Unsupported action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Export failed" }, 500);
  }
});
