-- Table for storing bank OAuth sessions (to avoid re-authentication)
CREATE TABLE IF NOT EXISTS public.bank_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL DEFAULT 'PKO BP',
  session_id TEXT NOT NULL,
  accounts JSONB DEFAULT '[]',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, bank_name)
);

ALTER TABLE public.bank_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own bank connections"
  ON public.bank_connections FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
