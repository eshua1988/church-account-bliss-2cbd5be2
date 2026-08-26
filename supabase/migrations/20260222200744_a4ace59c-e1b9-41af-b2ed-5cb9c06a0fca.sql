
-- Add bot_token column to telegram_users (nullable - if null, uses shared bot)
ALTER TABLE telegram_users ADD COLUMN bot_token text;

-- Create table for one-time link codes (simplified connection)
CREATE TABLE public.telegram_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL UNIQUE,
  bot_token text, -- optional: if user wants to connect their own bot
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  used boolean NOT NULL DEFAULT false
);

-- Enable RLS
ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

-- Users can manage their own link codes
CREATE POLICY "Users can view their own link codes"
ON public.telegram_link_codes FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own link codes"
ON public.telegram_link_codes FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own link codes"
ON public.telegram_link_codes FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own link codes"
ON public.telegram_link_codes FOR DELETE
USING (auth.uid() = user_id);

-- Index for fast code lookup
CREATE INDEX idx_telegram_link_codes_code ON public.telegram_link_codes (code) WHERE used = false;
