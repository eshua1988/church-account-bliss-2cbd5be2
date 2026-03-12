-- Add message_templates column to telegram_bot_config
ALTER TABLE public.telegram_bot_config
  ADD COLUMN IF NOT EXISTS message_templates jsonb DEFAULT '[]'::jsonb;
