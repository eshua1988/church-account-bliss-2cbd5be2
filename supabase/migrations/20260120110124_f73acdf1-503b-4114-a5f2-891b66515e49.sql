-- Create table for shared payout links
CREATE TABLE public.shared_payout_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.shared_payout_links ENABLE ROW LEVEL SECURITY;

-- Owner can manage their links
CREATE POLICY "Users can view their own links"
  ON public.shared_payout_links FOR SELECT
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can insert their own links"
  ON public.shared_payout_links FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Users can update their own links"
  ON public.shared_payout_links FOR UPDATE
  USING (auth.uid() = owner_user_id);

CREATE POLICY "Users can delete their own links"
  ON public.shared_payout_links FOR DELETE
  USING (auth.uid() = owner_user_id);

-- Allow anonymous read for valid tokens (for public form access)
CREATE POLICY "Anyone can read active links by token"
  ON public.shared_payout_links FOR SELECT
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Allow anonymous transactions insertion with valid token link
CREATE POLICY "Public can insert transactions via shared link"
  ON public.transactions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shared_payout_links 
      WHERE owner_user_id = transactions.user_id 
        AND is_active = true 
        AND (expires_at IS NULL OR expires_at > now())
    )
  );

-- Allow public to read categories for shared link users
CREATE POLICY "Public can read categories for shared links"
  ON public.categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.shared_payout_links 
      WHERE owner_user_id = categories.user_id 
        AND is_active = true 
        AND (expires_at IS NULL OR expires_at > now())
    )
  );