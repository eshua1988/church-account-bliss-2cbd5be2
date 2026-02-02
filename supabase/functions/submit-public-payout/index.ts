import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
}

// Simple in-memory rate limiting (per token)
// In production, you'd use Redis or database
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
  // Validate token presence
  if (!data.token || typeof data.token !== 'string' || data.token.length < 10 || data.token.length > 100) {
    return { valid: false, error: 'Invalid token format' };
  }
  
  // Validate amount
  if (typeof data.amount !== 'number' || isNaN(data.amount)) {
    return { valid: false, error: 'Amount must be a number' };
  }
  if (data.amount <= 0) {
    return { valid: false, error: 'Amount must be greater than 0' };
  }
  if (data.amount > MAX_AMOUNT) {
    return { valid: false, error: `Amount cannot exceed ${MAX_AMOUNT}` };
  }
  
  // Validate currency
  if (!data.currency || !VALID_CURRENCIES.includes(data.currency)) {
    return { valid: false, error: `Invalid currency. Must be one of: ${VALID_CURRENCIES.join(', ')}` };
  }
  
  // Validate date format (YYYY-MM-DD)
  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    return { valid: false, error: 'Invalid date format. Use YYYY-MM-DD' };
  }
  
  // Validate date range (not too far in past or future)
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
  
  // Validate text fields (optional but with length limits)
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
  
  // Validate categoryId format if provided (UUID)
  if (data.categoryId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.categoryId)) {
    return { valid: false, error: 'Invalid category ID format' };
  }
  
  return { valid: true };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as SubmitPayoutRequest;
    
    // Input validation
    const validation = validateInput(body);
    if (!validation.valid) {
      console.log('Validation failed:', validation.error);
      return new Response(
        JSON.stringify({ error: validation.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limiting
    if (!checkRateLimit(body.token)) {
      console.log('Rate limit exceeded for token');
      return new Response(
        JSON.stringify({ error: 'Too many submissions. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role to bypass RLS for secure validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate token and get owner (using service role - not exposed to client)
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

    // Check if link is active
    if (!linkData.is_active) {
      return new Response(
        JSON.stringify({ error: 'This link is no longer active' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check expiration
    if (linkData.expires_at && new Date(linkData.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: 'This link has expired' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate category ownership if provided
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

    // Insert transaction (using service role to bypass RLS safely after validation)
    const { data: txData, error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: linkData.owner_user_id,
        type: 'expense',
        amount: body.amount,
        currency: body.currency,
        category_id: body.categoryId || null,
        description: body.description?.slice(0, MAX_TEXT_LENGTH) || null,
        date: body.date,
        issued_to: body.issuedTo?.slice(0, MAX_TEXT_LENGTH) || null,
        amount_in_words: body.amountInWords?.slice(0, MAX_TEXT_LENGTH) || null,
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

    console.log('Transaction saved successfully:', txData.id);

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
