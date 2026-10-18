-- PDF payment dates are accounting dates, not notification dates.  Preserve
-- the existing schedule as the initial PDF payment schedule for old cards.
UPDATE public.reminders
SET recurring_pdf = recurring_pdf || jsonb_build_object(
  'payment_start_date', reminder_date,
  'payment_repeat', repeat
)
WHERE recurring_pdf IS NOT NULL
  AND (recurring_pdf->>'payment_start_date' IS NULL OR recurring_pdf->>'payment_repeat' IS NULL);

-- Add each payment due under the PDF card's own schedule.  Notifications are
-- handled separately below from the global schedule stored on every card.
CREATE OR REPLACE FUNCTION public.process_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item public.reminders%ROWTYPE;
  next_at timestamptz;
  scheduled_at timestamptz;
  payment_date date;
  payment_repeat text;
  source_entry_id uuid;
  payment_rows integer;
  processed integer := 0;
BEGIN
  FOR item IN
    SELECT * FROM public.reminders
    WHERE closed_at IS NULL
      AND recurring_pdf IS NOT NULL
  LOOP
    payment_date := COALESCE(NULLIF(item.recurring_pdf->>'payment_start_date', '')::date, item.reminder_date);
    payment_repeat := COALESCE(NULLIF(item.recurring_pdf->>'payment_repeat', ''), item.repeat);
    source_entry_id := NULLIF(item.recurring_pdf->>'source_entry_id', '')::uuid;
    IF payment_date IS NULL OR source_entry_id IS NULL THEN
      CONTINUE;
    END IF;

    WHILE payment_date <= CURRENT_DATE LOOP
      INSERT INTO public.recurring_pdf_payment_occurrences (reminder_id, scheduled_for, amount, currency)
      VALUES (
        item.id,
        payment_date,
        (item.recurring_pdf->>'amount')::numeric,
        COALESCE(NULLIF(item.recurring_pdf->>'currency', ''), 'PLN')
      ) ON CONFLICT (reminder_id, scheduled_for) DO NOTHING;
      GET DIAGNOSTICS payment_rows = ROW_COUNT;

      IF payment_rows > 0 THEN
        UPDATE public.pdf_archive_entries
        SET amount = amount + (item.recurring_pdf->>'amount')::numeric
        WHERE id = source_entry_id
          AND user_id = item.user_id
          AND currency = COALESCE(NULLIF(item.recurring_pdf->>'currency', ''), 'PLN');
      END IF;

      payment_date := CASE payment_repeat
        WHEN 'weekly' THEN payment_date + interval '1 week'
        WHEN 'monthly' THEN payment_date + interval '1 month'
        WHEN 'yearly' THEN payment_date + interval '1 year'
        ELSE NULL
      END;
      EXIT WHEN payment_date IS NULL;
    END LOOP;
  END LOOP;

  -- The reminder date/time/repeat now always means notification schedule.
  FOR item IN
    SELECT * FROM public.reminders
    WHERE closed_at IS NULL
      AND next_notification_at IS NOT NULL
      AND next_notification_at <= now()
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

    scheduled_at := item.next_notification_at;
    next_at := CASE item.repeat
      WHEN 'once' THEN NULL
      WHEN 'weekly' THEN scheduled_at + interval '1 week'
      WHEN 'monthly' THEN scheduled_at + interval '1 month'
      WHEN 'yearly' THEN scheduled_at + interval '1 year'
      ELSE NULL
    END;
    WHILE next_at IS NOT NULL AND next_at <= now() LOOP
      next_at := CASE item.repeat
        WHEN 'weekly' THEN next_at + interval '1 week'
        WHEN 'monthly' THEN next_at + interval '1 month'
        WHEN 'yearly' THEN next_at + interval '1 year'
        ELSE NULL
      END;
    END LOOP;
    UPDATE public.reminders SET last_notified_at = now(), next_notification_at = next_at WHERE id = item.id;
    processed := processed + 1;
  END LOOP;
  RETURN processed;
END;
$$;
