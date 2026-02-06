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

interface NoteData {
  row: number;
  col: number;
  note: string;
}

interface SheetRequest {
  action: 'read' | 'write' | 'append' | 'delete';
  spreadsheetId: string;
  range: string;
  values?: string[][];
  transactionId?: string;
  notes?: NoteData[];
}

async function authenticateRequest(req: Request): Promise<{ userId: string; token: string; authHeader: string } | Response> {
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
  return { userId: user.id, token, authHeader };
}

async function getAccessToken(): Promise<string> {
  const credentials = JSON.parse(Deno.env.get('GOOGLE_SHEETS_CREDENTIALS') || '{}');
  
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

  // Base64url encode
  const base64urlEncode = (obj: object) => {
    const json = JSON.stringify(obj);
    const base64 = btoa(json);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const headerEncoded = base64urlEncode(header);
  const claimEncoded = base64urlEncode(claim);
  const signatureInput = `${headerEncoded}.${claimEncoded}`;

  // Import private key and sign
  const pemContents = credentials.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
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
    console.error('Token response:', tokenData);
    throw new Error('Failed to get access token');
  }
  
  return tokenData.access_token;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authResult.authHeader } } }
    );

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('spreadsheet_id, sheet_range')
      .eq('user_id', authResult.userId)
      .single();

    if (profileError) {
      console.error('Failed to load user profile for sheets settings:', profileError);
      return new Response(
        JSON.stringify({ error: 'Bad request: Missing Google Sheets settings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const configuredSpreadsheetId = (profile?.spreadsheet_id ?? '').trim();
    const configuredRange = (profile?.sheet_range ?? "'Data app'!A:G").trim();

    if (!configuredSpreadsheetId) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Please configure your Google Sheets ID in settings' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Backwards compatibility: if client sends a spreadsheetId, ensure it matches the user's configured one.
    if (body.spreadsheetId && body.spreadsheetId !== configuredSpreadsheetId) {
      console.error(`Spreadsheet ID mismatch for user ${authResult.userId}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden: Spreadsheet ID mismatch' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const spreadsheetId = configuredSpreadsheetId;
    const range = configuredRange;
    const values = body.values;

    console.log(`Google Sheets action: ${action}, spreadsheet: ${spreadsheetId}, range: ${range}, user: ${authResult.userId}`);

    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Bad request: Missing action' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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

    const accessToken = await getAccessToken();
    const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    const notes = body.notes as NoteData[] | undefined;

    let response;

    switch (action) {
      case 'read': {
        response = await fetch(`${baseUrl}/values/${encodeURIComponent(range)}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        break;
      }
      
      case 'write': {
        if (!values) throw new Error('Values required for write action');
        
        // Get sheet ID from range (parse sheet name)
        const sheetName = range.split('!')[0].replace(/'/g, '');
        
        // Get spreadsheet metadata to find sheet ID
        const metadataResponse = await fetch(`${baseUrl}?fields=sheets.properties`, {
          headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        
        let sheetId = 0;
        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json();
          const sheet = metadata.sheets?.find((s: { properties: { title: string } }) => 
            s.properties.title === sheetName
          );
          sheetId = sheet?.properties?.sheetId ?? 0;
        }
        
        // First, clear the entire range including values AND notes
        // Using batchUpdate to clear notes for the entire data area
        const clearNotesRequest = {
          requests: [
            {
              // Clear all notes in columns A-Z, rows 1-1000
              repeatCell: {
                range: {
                  sheetId: sheetId,
                  startRowIndex: 0,
                  endRowIndex: 1000,
                  startColumnIndex: 0,
                  endColumnIndex: 26, // A-Z
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
        
        // Then clear the values
        const clearResponse = await fetch(
          `${baseUrl}/values/${encodeURIComponent(range)}:clear`,
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
        
        // Then, write the new values
        response = await fetch(
          `${baseUrl}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
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
          throw new Error(errorData.error?.message || 'Google Sheets values write error');
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
          `${baseUrl}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
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
      throw new Error(data.error?.message || 'Google Sheets API error');
    }

    console.log(`Google Sheets ${action} successful`);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in google-sheets function:', error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
