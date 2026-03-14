-- Add message_templates column if it was not added by the previous migration
ALTER TABLE public.telegram_bot_config
  ADD COLUMN IF NOT EXISTS message_templates jsonb DEFAULT '[]'::jsonb;

-- Add menu_order column for unified drag-and-drop ordering of buttons + templates
ALTER TABLE public.telegram_bot_config
  ADD COLUMN IF NOT EXISTS menu_order jsonb DEFAULT '[]'::jsonb;
