-- Keep the next delivery moment in UTC while the editor works in Warsaw time.
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS next_notification_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_reminder_delivery_time()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
    OR NEW.reminder_date IS DISTINCT FROM OLD.reminder_date
    OR NEW.reminder_time IS DISTINCT FROM OLD.reminder_time
    OR NEW.repeat IS DISTINCT FROM OLD.repeat THEN
    NEW.next_notification_at := ((NEW.reminder_date + NEW.reminder_time) AT TIME ZONE 'Europe/Warsaw');
    NEW.last_notified_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_reminder_delivery_time ON public.reminders;
CREATE TRIGGER set_reminder_delivery_time
  BEFORE INSERT OR UPDATE OF reminder_date, reminder_time, repeat ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_reminder_delivery_time();

UPDATE public.reminders
SET next_notification_at = ((reminder_date + reminder_time) AT TIME ZONE 'Europe/Warsaw')
WHERE next_notification_at IS NULL;

-- This function creates a distinct inbox entry only when a reminder becomes due.
-- The reminder card itself stays in public.reminders and is never deleted here.
CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item public.reminders%ROWTYPE;
  next_at timestamptz;
  processed integer := 0;
BEGIN
  FOR item IN
    SELECT * FROM public.reminders
    WHERE next_notification_at IS NOT NULL AND next_notification_at <= now()
    ORDER BY next_notification_at
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, is_read, metadata)
    VALUES (
      item.user_id,
      'Напоминание: ' || item.full_name,
      item.message,
      'reminder_alert',
      false,
      jsonb_build_object('reminder_id', item.id, 'contact', item.contact, 'scheduled_for', item.next_notification_at)
    );

    IF item.repeat = 'once' THEN
      next_at := NULL;
    ELSE
      next_at := item.next_notification_at;
      WHILE next_at <= now() LOOP
        next_at := CASE item.repeat
          WHEN 'weekly' THEN next_at + interval '1 week'
          WHEN 'monthly' THEN next_at + interval '1 month'
          WHEN 'yearly' THEN next_at + interval '1 year'
          ELSE NULL
        END;
      END LOOP;
    END IF;

    UPDATE public.reminders
    SET last_notified_at = now(), next_notification_at = next_at
    WHERE id = item.id;
    processed := processed + 1;
  END LOOP;
  RETURN processed;
END;
$$;

-- Supabase runs this database task every minute, including while the browser is closed.
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-due-reminders-every-minute') THEN
    PERFORM cron.schedule(
      'process-due-reminders-every-minute',
      '* * * * *',
      'SELECT public.process_due_reminders();'
    );
  END IF;
END;
$$;
