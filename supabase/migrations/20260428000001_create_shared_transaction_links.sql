-- Create shared_transaction_links table for public transaction table access
BEGIN;

CREATE TABLE IF NOT EXISTS public.shared_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create index on token for fast lookups
CREATE INDEX IF NOT EXISTS idx_shared_transaction_links_token ON public.shared_transaction_links(token);
CREATE INDEX IF NOT EXISTS idx_shared_transaction_links_owner ON public.shared_transaction_links(owner_user_id);

-- Enable row-level security
ALTER TABLE public.shared_transaction_links ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own shared transaction links" ON public.shared_transaction_links;
DROP POLICY IF EXISTS "Users can create shared transaction links" ON public.shared_transaction_links;
DROP POLICY IF EXISTS "Users can update their own shared transaction links" ON public.shared_transaction_links;
DROP POLICY IF EXISTS "Users can delete their own shared transaction links" ON public.shared_transaction_links;
DROP POLICY IF EXISTS "Anonymous users can view active links by token" ON public.shared_transaction_links;

-- Create RLS policies
CREATE POLICY "Users can view their own shared transaction links"
ON public.shared_transaction_links
FOR SELECT
USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can create shared transaction links"
ON public.shared_transaction_links
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Users can update their own shared transaction links"
ON public.shared_transaction_links
FOR UPDATE
USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own shared transaction links"
ON public.shared_transaction_links
FOR DELETE
USING (auth.uid() = owner_user_id);

-- Allow anonymous users to read active links by token
CREATE POLICY "Anonymous users can view active links by token"
ON public.shared_transaction_links
FOR SELECT
USING (is_active = true);

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_transaction_links TO authenticated;
GRANT SELECT ON public.shared_transaction_links TO anon;

COMMIT;
