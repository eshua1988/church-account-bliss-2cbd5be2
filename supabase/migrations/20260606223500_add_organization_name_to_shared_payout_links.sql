ALTER TABLE public.shared_payout_links
ADD COLUMN IF NOT EXISTS organization_name text;

COMMENT ON COLUMN public.shared_payout_links.organization_name IS 'Organization name shown on public payout forms and generated payout PDFs.';
