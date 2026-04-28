-- Create shared_transaction_links table for public transaction table access
CREATE TABLE IF NOT EXISTS shared_transaction_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create index on token for fast lookups
CREATE INDEX IF NOT EXISTS idx_shared_transaction_links_token ON shared_transaction_links(token);
CREATE INDEX IF NOT EXISTS idx_shared_transaction_links_owner ON shared_transaction_links(owner_user_id);

-- Enable row-level security
ALTER TABLE shared_transaction_links ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view their own shared transaction links"
ON shared_transaction_links
FOR SELECT
USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can create shared transaction links"
ON shared_transaction_links
FOR INSERT
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Users can update their own shared transaction links"
ON shared_transaction_links
FOR UPDATE
USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own shared transaction links"
ON shared_transaction_links
FOR DELETE
USING (auth.uid() = owner_user_id);

-- Enable realtime for shared_transaction_links
ALTER PUBLICATION supabase_realtime ADD TABLE shared_transaction_links;
