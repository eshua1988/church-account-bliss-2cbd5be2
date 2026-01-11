import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Allowed spreadsheet IDs for security
const ALLOWED_SPREADSHEET_IDS = [
  Deno.env.get('ALLOWED_SPREADSHEET_ID') || '1WFFz7EV2ZUor-sQhvkZj3EHoTLRiEYjuxrTwLB96QKI'
];

interface SheetRequest {
  action: 'read' | 'write' | 'append';
  spreadsheetId: string;
  range: string;
  values?: string[][];
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
    const { action, spreadsheetId, range, values }: SheetRequest = await req.json();
    
    console.log(`Google Sheets action: ${action}, spreadsheet: ${spreadsheetId}, range: ${range}`);

    // Validate spreadsheet ID against whitelist for security
    if (!ALLOWED_SPREADSHEET_IDS.includes(spreadsheetId)) {
      console.error(`Unauthorized spreadsheet ID: ${spreadsheetId}`);
      return new Response(
        JSON.stringify({ error: 'Forbidden: Invalid spreadsheet ID' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!spreadsheetId || !range) {
      throw new Error('Missing required parameters: spreadsheetId and range');
    }

    const accessToken = await getAccessToken();
    const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

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
        break;
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
