-- A user chooses one notification schedule for all reminder cards.
CREATE TABLE IF NOT EXISTS public.reminder_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_date date NOT NULL DEFAULT CURRENT_DATE,
  reminder_time time NOT NULL DEFAULT '09:00:00',
  repeat text NOT NULL DEFAULT 'once' CHECK (repeat IN ('once', 'weekly', 'monthly', 'yearly')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own reminder settings" ON public.reminder_settings;
CREATE POLICY "Users manage own reminder settings"
  ON public.reminder_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
