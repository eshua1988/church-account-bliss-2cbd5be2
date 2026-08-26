-- Add button_layout column for per-user layout settings (buttons per row, size, color)
ALTER TABLE public.telegram_bot_config
  ADD COLUMN IF NOT EXISTS button_layout jsonb DEFAULT '{}'::jsonb;
