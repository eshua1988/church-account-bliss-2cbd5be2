-- Add anonymous access policy to shared_transaction_links table
-- Run this if table exists but doesn't have the anonymous access policy

BEGIN;

-- Drop the policy if it exists
DROP POLICY IF EXISTS "Anonymous users can view active links by token" ON public.shared_transaction_links;

-- Create the policy to allow anonymous access to active links
CREATE POLICY "Anonymous users can view active links by token"
ON public.shared_transaction_links
FOR SELECT
USING (is_active = true);

-- Ensure anon role has SELECT permission
GRANT SELECT ON public.shared_transaction_links TO anon;

COMMIT;
