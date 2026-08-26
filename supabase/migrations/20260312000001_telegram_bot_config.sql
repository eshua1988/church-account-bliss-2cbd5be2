-- Telegram bot menu configuration per user
CREATE TABLE IF NOT EXISTS public.telegram_bot_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  welcome_message text DEFAULT '👋 Выберите действие:',
  extra_buttons jsonb DEFAULT '[]'::jsonb,
  bot_commands jsonb DEFAULT '[]'::jsonb,
  show_payout_links boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.telegram_bot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own bot config"
ON public.telegram_bot_config
FOR ALL USING (auth.uid() = user_id);

CREATE TRIGGER update_telegram_bot_config_updated_at
BEFORE UPDATE ON public.telegram_bot_config
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
