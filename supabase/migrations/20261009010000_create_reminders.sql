-- Reminder cards are independent records. They must never appear in the
-- operational notifications inbox before their scheduled notification is sent.
CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  contact text NOT NULL,
  message text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  reminder_date date NOT NULL,
  repeat text NOT NULL DEFAULT 'once' CHECK (repeat IN ('once', 'weekly', 'monthly', 'yearly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reminders_user_date_idx ON public.reminders(user_id, reminder_date);
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own reminders"
  ON public.reminders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_reminders_updated_at
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Move reminder cards created by the first version out of the notifications
-- inbox. Their IDs and file metadata are preserved.
INSERT INTO public.reminders (id, user_id, full_name, contact, message, attachments, reminder_date, repeat, created_at)
SELECT
  id,
  user_id,
  COALESCE(NULLIF(metadata->>'full_name', ''), title),
  COALESCE(metadata->>'contact', ''),
  message,
  COALESCE(metadata->'attachments', '[]'::jsonb),
  COALESCE(NULLIF(metadata->>'reminder_date', '')::date, created_at::date),
  CASE WHEN metadata->>'repeat' IN ('once', 'weekly', 'monthly', 'yearly') THEN metadata->>'repeat' ELSE 'once' END,
  created_at
FROM public.notifications
WHERE type = 'reminder'
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.notifications WHERE type = 'reminder';
