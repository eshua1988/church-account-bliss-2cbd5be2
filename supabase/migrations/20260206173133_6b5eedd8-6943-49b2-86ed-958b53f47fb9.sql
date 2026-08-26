-- Add link_type column to shared_payout_links
ALTER TABLE public.shared_payout_links 
ADD COLUMN link_type text NOT NULL DEFAULT 'standard';

-- Add comment
COMMENT ON COLUMN public.shared_payout_links.link_type IS 'Type of link: standard (all fields at once) or stepwise (step-by-step with intermediate saves)';