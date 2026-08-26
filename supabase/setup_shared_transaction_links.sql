-- Execute this SQL directly in Supabase SQL Editor if migrations didn't run
-- This creates the shared_transaction_links table

BEGIN;

DROP TABLE IF EXISTS public.shared_transaction_links CASCADE;

CREATE TABLE public.shared_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX idx_shared_transaction_links_token ON public.shared_transaction_links(token);
CREATE INDEX idx_shared_transaction_links_owner ON public.shared_transaction_links(owner_user_id);

-- Enable RLS
ALTER TABLE public.shared_transaction_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Allow authenticated users to view their own links
CREATE POLICY "Users can view their own shared transaction links"
ON public.shared_transaction_links
FOR SELECT
USING (auth.uid() = owner_user_id);

-- Allow authenticated users to create links
CREATE POLICY "Users can create shared transaction links"
ON public.shared_transaction_links
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

-- Allow authenticated users to update their own links
CREATE POLICY "Users can update their own shared transaction links"
ON public.shared_transaction_links
FOR UPDATE
USING (auth.uid() = owner_user_id);

-- Allow authenticated users to delete their own links
CREATE POLICY "Users can delete their own shared transaction links"
ON public.shared_transaction_links
FOR DELETE
USING (auth.uid() = owner_user_id);

-- Allow anonymous users to read active links by token (for public access)
CREATE POLICY "Anonymous users can view active links by token"
ON public.shared_transaction_links
FOR SELECT
USING (is_active = true);

-- Permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shared_transaction_links TO authenticated;
GRANT SELECT ON public.shared_transaction_links TO anon;

COMMIT;
