-- Add banking import columns to transactions table
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS external_id TEXT DEFAULT NULL;

-- Unique constraint on external_id to prevent duplicate imports
CREATE UNIQUE INDEX IF NOT EXISTS transactions_external_id_unique
  ON public.transactions (external_id)
  WHERE external_id IS NOT NULL;
