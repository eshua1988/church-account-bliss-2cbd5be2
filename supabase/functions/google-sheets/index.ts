import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Validate spreadsheet ID format (alphanumeric, hyphens, underscores)
function isValidSpreadsheetId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 10 && id.length < 100;
}

/** Convert 1-based column number to letter(s): 1→A, 26→Z, 27→AA, 28→AB … */
function numToColLetter(n: number): string {
  let col = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

function colLetterToNumber(column: string): number {
  return column.split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0);
}

/**
 * Expand the column range in a sheet reference so it covers `colCount` columns.
 * E.g. "'Data app'!A:Z" with colCount=30 → "'Data app'!A:AD"
 * If there are no column bounds (e.g. "Sheet1!A1:Z100") the bounds are left untouched.
 */
function expandRangeColumns(range: string, colCount: number): string {
  const count = Math.max(colCount, 1);
  // Match patterns like "A:Z" or "A:AZ" at the end of the range
  return range.replace(/([A-Z]+):([A-Z]+)$/, (_match, startColumn: string) => {
    const lastCol = numToColLetter(colLetterToNumber(startColumn) + count - 1);
    return `${startColumn}:${lastCol}`;
  });
}

interface NoteData {
  row: number;
  col: number;
  note: string;
}

interface SheetRequest {
  action: 'read' | 'write' | 'append' | 'delete' | 'diagnose' | 'mark-matches' | 'list-sheets';
  spreadsheetId: string;
  range: string;
  values?: string[][];
  transactionId?: string;
  notes?: NoteData[];
  transactionTypeColors?: boolean;
  matches?: Array<{ row: number; nameColumn: number; note: string }>;
  clearMatchNotes?: { startRowIndex: number; endRowIndex: number; columnIndex: number };
}

async function authenticateRequest(req: Request): Promise<{ userId: string; token: string; authHeader: string; internal: boolean } | Response> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    console.error('Missing or invalid authorization header');
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Missing authorization header' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Missing token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Trusted calls from another Edge Function may act for a link owner without
  // exposing the service-role key or spreadsheet settings to the public client.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const internalOwnerId = req.headers.get('x-owner-user-id')?.trim() ?? '';
  if (serviceRoleKey && token === serviceRoleKey && /^[0-9a-f-]{36}$/i.test(internalOwnerId)) {
    return { userId: internalOwnerId, token, authHeader, internal: true };
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  // IMPORTANT: In edge/runtime, do not rely on auth storage; validate using the provided JWT.
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('User verification failed:', error?.message);
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Authenticated user: ${user.id}`);
  return { userId: user.id, token, authHeader, internal: false };
}

async function getAccessToken(): Promise<string> {
  const rawCreds = Deno.env.get('GOOGLE_SHEETS_CREDENTIALS') || '{}';
  
  let credentials: { client_email?: string; private_key?: string };
  try {
    credentials = JSON.parse(rawCreds);
  } catch (e) {
    throw new Error(`Invalid GOOGLE_SHEETS_CREDENTIALS JSON: ${e}`);
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('GOOGLE_SHEETS_CREDENTIALS missing client_email or private_key');
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // Base64url encode — use TextEncoder for safety (no deprecated unescape)
  const base64urlEncode = (obj: object) => {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerEncoded = base64urlEncode(header);
  const claimEncoded = base64urlEncode(claim);
  const signatureInput = `${headerEncoded}.${claimEncoded}`;

  // Import private key and sign — strip ALL whitespace/CR/LF and PEM headers
  const pemContents = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');  // handles both LF and CRLF (Windows)

  let binaryKey: Uint8Array;
  try {
    binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  } catch (e) {
    throw new Error(`Failed to decode private key base64: ${e}`);
  }

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const signatureEncoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const jwt = `${signatureInput}.${signatureEncoded}`;

  // Exchange JWT for access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResponse.json();
  
  if (!tokenData.access_token) {
    console.error('Token exchange failed. Response:', JSON.stringify(tokenData));
    const hint = tokenData.error === 'invalid_grant'
      ? ' Возможно таблица не открыта для сервисного аккаунта.'
      : '';
    throw new Error(`Failed to get Google access token: ${tokenData.error_description || tokenData.error || 'unknown'}${hint}`);
  }
  
  return tokenData.access_token;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Public health/diagnose endpoint (no auth required)
  const url = new URL(req.url);
  if (url.pathname.endsWith('/health') || url.searchParams.get('action') === 'health') {
    const rawCreds = Deno.env.get('GOOGLE_SHEETS_CREDENTIALS') || '';
    const info: Record<string, unknown> = { creds_length: rawCreds.length };
    try {
      const parsed = JSON.parse(rawCreds);
      info.type = parsed.type;
      info.client_email = parsed.client_email;
      info.has_private_key = !!parsed.private_key;
      info.private_key_length = (parsed.private_key || '').length;
      info.private_key_starts = (parsed.private_key || '').substring(0, 27);
    } catch (e) {
      info.parse_error = String(e);
    }
    try {
      const tok = await getAccessToken();
      info.token_ok = true;
      info.token_prefix = tok.substring(0, 15);
    } catch (e) {
      info.token_error = String(e);
    }
    return new Response(JSON.stringify(info, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Authenticate the request first
    const authResult = await authenticateRequest(req);
    if (authResult instanceof Response) {
      return authResult; // Return error response if authentication failed
    }

    const body: Partial<SheetRequest> = await req.json();
    const action = body.action;

    // Look up the user's configured spreadsheet in the database (do NOT trust client-supplied IDs)
    const supabase = authResult.internal
      ? createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )
      : createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: authResult.authHeader } } }
        );

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('spreadsheet_id, sheet_range')
      .eq('user_id', authResult.userId)
      .maybeSingle();

    if (profileError) {
      console.error('Failed to load user profile for sheets settings:', profileError);
      return new Response(
        JSON.stringify({ error: 'Bad request: Could not load user settings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!profile && !authResult.internal) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Please configure your Google Sheets ID in settings first' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const configuredSpreadsheetId = (profile?.spreadsheet_id ?? '').trim();
    const configuredRange = (profile?.sheet_range ?? "'Data app'!A:G").trim();

    if (!configuredSpreadsheetId && !authResult.internal) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Please configure your Google Sheets ID in settings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Backwards compatibility: if client sends a spreadsheetId, ensure it matches the user's configured one.
    if (!authResult.internal && body.spreadsheetId && body.spreadsheetId !== configuredSpreadsheetId) {
      console.error(`Spreadsheet ID mismatch for user ${authResult.userId}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden: Spreadsheet ID mismatch' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Internal functions can access explicitly configured registration sources.
    // Browser clients are still locked to their profile's single export sheet.
    const spreadsheetId = authResult.internal && body.spreadsheetId ? body.spreadsheetId : configuredSpreadsheetId;
    const range = authResult.internal && body.range ? body.range : configuredRange;
    const values = body.values;

    console.log(`Google Sheets action: ${action}, spreadsheet: ${spreadsheetId}, range: ${range}, user: ${authResult.userId}`);

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Missing action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── DIAGNOSE: test credentials without touching the spreadsheet ──
    if (action === 'diagnose') {
      const rawCreds = Deno.env.get('GOOGLE_SHEETS_CREDENTIALS') || '';
      const diagInfo: Record<string, unknown> = {
        creds_length: rawCreds.length,
        creds_first20: rawCreds.substring(0, 20),
        spreadsheet_id: configuredSpreadsheetId,
        sheet_range: configuredRange,
      };
      try {
        const parsed = JSON.parse(rawCreds);
        diagInfo.creds_type = parsed.type;
        diagInfo.creds_email = parsed.client_email;
        diagInfo.has_private_key = !!parsed.private_key;
        diagInfo.private_key_length = parsed.private_key?.length ?? 0;
        diagInfo.private_key_starts = parsed.private_key?.substring(0, 30);
      } catch (e) {
        diagInfo.parse_error = String(e);
      }
      // Try to get access token
      try {
        const tok = await getAccessToken();
        diagInfo.token_ok = true;
        diagInfo.token_prefix = tok.substring(0, 10);
      } catch (e) {
        diagInfo.token_error = String(e);
      }
      return new Response(JSON.stringify(diagInfo), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate spreadsheet ID format for security
    if (!isValidSpreadsheetId(spreadsheetId)) {
      console.error(`Invalid spreadsheet ID format: ${spreadsheetId}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden: Invalid spreadsheet ID format' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!range || range.length > 200) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Invalid range' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = await (async () => {
      try {
        return await getAccessToken();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Ошибка получения токена Google: ${msg}`);
      }
    })();
    const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const notes = body.notes as NoteData[] | undefined;

    // Fetch spreadsheet metadata once — used for sheet name resolution and sheetId lookup
    type SheetInfo = { properties: { title: string; sheetId: number; gridProperties?: { rowCount?: number; columnCount?: number } } };
    const metaResp = await fetch(`${baseUrl}?fields=sheets.properties`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!metaResp.ok) {
      const metaErr = await metaResp.json().catch(() => ({}));
      console.error('Failed to get spreadsheet metadata:', metaErr);
      const errMsg = (metaErr as { error?: { message?: string } })?.error?.message || 'Cannot access spreadsheet';
      const status = metaResp.status === 403 ? 403 : metaResp.status === 404 ? 404 : 500;
      return new Response(
        JSON.stringify({ error: `Google Sheets: ${errMsg}. Убедитесь что таблица открыта для сервисного аккаунта: church-accounting@church-accounting-of-finances.iam.gserviceaccount.com` }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const meta = await metaResp.json();
    const sheetsInfo: SheetInfo[] = meta.sheets ?? [];
    if (action === 'list-sheets') {
      return new Response(JSON.stringify({ success: true, sheets: sheetsInfo.map(sheet => sheet.properties.title) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const firstSheetName = sheetsInfo[0]?.properties?.title ?? 'Sheet1';

    // Resolve the actual range: if configured sheet name doesn't exist → use first sheet
    let resolvedRange = range;
    const sheetMatch = range.match(/^'?([^'!]+)'?!/);
    if (sheetMatch) {
      const requestedSheet = sheetMatch[1];
      const exists = sheetsInfo.some(s => s.properties.title === requestedSheet);
      if (!exists) {
        console.log(`Sheet "${requestedSheet}" not found, falling back to first sheet "${firstSheetName}"`);
        resolvedRange = range.replace(/^'?[^'!]+'?!/, `'${firstSheetName}'!`);
      }
    } else {
      // No sheet prefix → prepend first sheet name
      resolvedRange = `'${firstSheetName}'!${range}`;
    }
    console.log(`Resolved range: ${resolvedRange}`);

    // Get sheetId for batchUpdate requests
    const resolvedSheetName = (resolvedRange.match(/^'?([^'!]+)'?!/) || [])[1] ?? firstSheetName;
    const resolvedSheetInfo = sheetsInfo.find(s => s.properties.title === resolvedSheetName);
    const sheetIdNum = resolvedSheetInfo?.properties?.sheetId ?? 0;
    const existingColumnCount = resolvedSheetInfo?.properties?.gridProperties?.columnCount ?? 0;
    const rangeColumnMatch = resolvedRange.match(/([A-Z]+):[A-Z]+$/);
    const rangeStartColumnIndex = rangeColumnMatch ? colLetterToNumber(rangeColumnMatch[1]) - 1 : 0;

    let response;

    switch (action) {
      case 'read': {
        response = await fetch(`${baseUrl}/values/${encodeURIComponent(resolvedRange)}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        break;
      }
      
      case 'write': {
        if (!values) throw new Error('Values required for write action');

        // Dynamically expand range to cover actual data width (avoids "tried writing to column AA" errors)
        const maxDataCols = Math.max(...values.map(row => row.length), 1);
        const writeRange = expandRangeColumns(resolvedRange, maxDataCols);
        console.log(`Write range expanded: ${resolvedRange} → ${writeRange} (${maxDataCols} columns)`);

        const sheetId = sheetIdNum;
        const clearColumnCount = Math.max(maxDataCols, existingColumnCount, 1);
        const clearRange = expandRangeColumns(resolvedRange, clearColumnCount);
        const clearNotesRequest = {
          requests: [
            {
              // Clear all notes across the current sheet width so removed departments disappear.
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1000,
                  startColumnIndex: rangeStartColumnIndex,
                  endColumnIndex: rangeStartColumnIndex + clearColumnCount,
                },
                cell: {
                  note: '',
                },
                fields: 'note',
              },
            },
          ],
        };
        
        const clearNotesResponse = await fetch(`${baseUrl}:batchUpdate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(clearNotesRequest),
        });
        
        if (!clearNotesResponse.ok) {
          const clearNotesError = await clearNotesResponse.json();
          console.error('Failed to clear notes:', clearNotesError);
          // Continue anyway
        } else {
          console.log('Cleared existing notes from sheet');
        }
        
        // Then clear values across the current sheet width. This removes stale department
        // columns left over from previous syncs when categories were renamed or deleted.
        const clearResponse = await fetch(
          `${baseUrl}/values/${encodeURIComponent(clearRange)}:clear`,

          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        if (!clearResponse.ok) {
          const clearError = await clearResponse.json();
          console.error('Google Sheets clear error:', clearError);
          // Continue anyway, the write might still work
        } else {
          console.log('Cleared existing data from sheet');
        }
        
        // Then, write the new values using the dynamically-expanded range
        response = await fetch(
          `${baseUrl}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,

          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values }),
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json();
          console.error('Google Sheets values write error:', errorData);
          const msg = errorData.error?.message || JSON.stringify(errorData.error) || 'Google Sheets write error';
          const status = response.status === 403 ? 403 : response.status === 404 ? 404 : 500;
          return new Response(
            JSON.stringify({ error: msg }),
            { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (body.transactionTypeColors && values.length > 1) {
          const formatRequests: Record<string, unknown>[] = [
            {
              repeatCell: {
                range: {
                  sheetId,
                  startRowIndex: 1,
                  endRowIndex: values.length,
                  startColumnIndex: rangeStartColumnIndex,
                  endColumnIndex: rangeStartColumnIndex + Math.min(4, maxDataCols),
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 1, green: 1, blue: 1 },
                    textFormat: {
                      foregroundColor: { red: 0.12, green: 0.12, blue: 0.12 },
                      bold: false,
                    },
                  },
                },
                fields: 'userEnteredFormat(backgroundColor,textFormat)',
              },
            },
          ];

          const colorRuns: Array<{ type: 'income' | 'expense'; start: number; end: number }> = [];
          let currentRun: { type: 'income' | 'expense'; start: number; end: number } | null = null;

          for (let rowIndex = 1; rowIndex < values.length; rowIndex += 1) {
            const type = String(values[rowIndex]?.[3] || '').trim().toLowerCase() === 'доход'
              ? 'income'
              : 'expense';
            if (currentRun?.type === type && currentRun.end === rowIndex) {
              currentRun.end = rowIndex + 1;
            } else {
              currentRun = { type, start: rowIndex, end: rowIndex + 1 };
              colorRuns.push(currentRun);
            }
          }

          const greenFormat = {
            backgroundColor: { red: 0.86, green: 0.97, blue: 0.89 },
            textFormat: {
              foregroundColor: { red: 0.04, green: 0.45, blue: 0.18 },
              bold: true,
            },
          };
          const redFormat = {
            backgroundColor: { red: 1, green: 0.89, blue: 0.89 },
            textFormat: {
              foregroundColor: { red: 0.75, green: 0.08, blue: 0.08 },
              bold: true,
            },
          };

          for (const run of colorRuns) {
            const format = run.type === 'income' ? greenFormat : redFormat;
            const columnRanges = run.type === 'income'
              ? [[0, 1], [2, 4]]
              : [[1, 4]];

            for (const [startColumnIndex, endColumnIndex] of columnRanges) {
              formatRequests.push({
                repeatCell: {
                  range: {
                    sheetId,
                    startRowIndex: run.start,
                    endRowIndex: run.end,
                  startColumnIndex: rangeStartColumnIndex + startColumnIndex,
                  endColumnIndex: rangeStartColumnIndex + endColumnIndex,
                  },
                  cell: { userEnteredFormat: format },
                  fields: 'userEnteredFormat(backgroundColor,textFormat)',
                },
              });
            }
          }

          const formatResponse = await fetch(`${baseUrl}:batchUpdate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests: formatRequests }),
          });

          if (!formatResponse.ok) {
            const formatError = await formatResponse.json().catch(() => ({}));
            console.error('Failed to color transaction cells:', formatError);
          }
        }
        
        // Then, add notes if provided
        if (notes && notes.length > 0) {
          // Build batch update requests for notes (sheetId already fetched above)
          const notesRequests = notes.map((noteData) => ({
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: noteData.row,
                endRowIndex: noteData.row + 1,
                startColumnIndex: noteData.col,
                endColumnIndex: noteData.col + 1,
              },
              cell: {
                note: noteData.note,
              },
              fields: 'note',
            },
          }));
          
          // Send batch update for notes
          const notesResponse = await fetch(`${baseUrl}:batchUpdate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ requests: notesRequests }),
          });
          
          if (!notesResponse.ok) {
            const notesError = await notesResponse.json();
            console.error('Failed to add notes:', notesError);
            // Don't throw, just log - values were written successfully
          } else {
            console.log(`Added ${notes.length} notes to spreadsheet`);
          }
        }
        
        console.log('Google Sheets write successful');
        return new Response(JSON.stringify({ success: true, updatedRows: values.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'append': {
        if (!values) throw new Error('Values required for append action');
        response = await fetch(
          `${baseUrl}/values/${encodeURIComponent(resolvedRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values }),
          }
        );
        break;
      }

      case 'mark-matches': {
        const matches = Array.isArray(body.matches) ? body.matches : [];
        const clearMatchNotes = body.clearMatchNotes;
        const requests: Record<string, unknown>[] = [];
        if (clearMatchNotes
          && Number.isInteger(clearMatchNotes.startRowIndex)
          && Number.isInteger(clearMatchNotes.endRowIndex)
          && Number.isInteger(clearMatchNotes.columnIndex)
          && clearMatchNotes.startRowIndex >= 1
          && clearMatchNotes.endRowIndex > clearMatchNotes.startRowIndex
          && clearMatchNotes.columnIndex >= 0) {
          // Notes from a previous run must not remain on rows which no longer
          // have a reliable payment match. Only notes are cleared; the sheet's
          // existing colours and other formatting are left untouched.
          requests.push({
            repeatCell: {
              range: {
                sheetId: sheetIdNum,
                startRowIndex: clearMatchNotes.startRowIndex,
                endRowIndex: clearMatchNotes.endRowIndex,
                startColumnIndex: clearMatchNotes.columnIndex,
                endColumnIndex: clearMatchNotes.columnIndex + 1,
              },
              cell: { note: '' },
              fields: 'note',
            },
          });
        }
        requests.push(...matches.slice(0, 500).flatMap((match) => {
          const row = Number(match.row);
          const col = Number(match.nameColumn);
          if (!Number.isInteger(row) || row < 1 || !Number.isInteger(col) || col < 0) return [];
          const cellRange = { sheetId: sheetIdNum, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: col, endColumnIndex: col + 1 };
          return [
            { repeatCell: { range: cellRange, cell: { userEnteredFormat: { backgroundColor: { red: 0.84, green: 0.96, blue: 0.86 }, textFormat: { foregroundColor: { red: 0.04, green: 0.42, blue: 0.16 }, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
            { repeatCell: { range: cellRange, cell: { note: String(match.note || '').slice(0, 45000) }, fields: 'note' } },
          ];
        }));
        if (requests.length === 0) {
          return new Response(JSON.stringify({ success: true, marked: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const markResponse = await fetch(`${baseUrl}:batchUpdate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        });
        if (!markResponse.ok) {
          const error = await markResponse.json().catch(() => ({}));
          throw new Error(error?.error?.message || 'Failed to mark matching rows');
        }
        return new Response(JSON.stringify({ success: true, marked: Math.floor(requests.length / 2) }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      case 'delete': {
        const transactionId = body.transactionId;
        if (!transactionId) throw new Error('Transaction ID required for delete action');
        
        // Delete from Supabase database
        const { error: deleteError } = await supabase
          .from('transactions')
          .delete()
          .eq('id', transactionId)
          .eq('user_id', authResult.userId);
        
        if (deleteError) {
          console.error('Delete error:', deleteError);
          throw new Error(`Failed to delete transaction: ${deleteError.message}`);
        }
        
        console.log(`Transaction ${transactionId} deleted successfully`);
        
        return new Response(
          JSON.stringify({ success: true, deletedId: transactionId }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Google Sheets API error:', data);
      const msg = data.error?.message || JSON.stringify(data.error) || 'Google Sheets API error';
      const status = response.status === 403 ? 403 : response.status === 404 ? 404 : 500;
      return new Response(
        JSON.stringify({ error: msg }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Google Sheets ${action} successful`);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Unhandled error in google-sheets function:', errorMessage, error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
