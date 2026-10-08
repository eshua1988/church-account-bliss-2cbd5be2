ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS reminder_time time NOT NULL DEFAULT '09:00:00';
