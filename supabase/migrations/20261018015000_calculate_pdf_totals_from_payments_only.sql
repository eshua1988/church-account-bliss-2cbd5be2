-- The original payout value is a document value, not a recurring-payment
-- amount.  A recurring PDF total is therefore the sum of its entered payments
-- only, counted from payment_start_date.
DO $$
DECLARE
  item public.reminders%ROWTYPE;
  payment_date date;
  payment_repeat text;
  source_entry_id uuid;
BEGIN
  FOR item IN
    SELECT * FROM public.reminders
    WHERE recurring_pdf IS NOT NULL
  LOOP
    payment_date := COALESCE(NULLIF(item.recurring_pdf->>'payment_start_date', '')::date, item.reminder_date);
    payment_repeat := COALESCE(NULLIF(item.recurring_pdf->>'payment_repeat', ''), item.repeat);
    source_entry_id := NULLIF(item.recurring_pdf->>'source_entry_id', '')::uuid;
    IF payment_date IS NULL OR source_entry_id IS NULL THEN CONTINUE; END IF;

    WHILE payment_date <= CURRENT_DATE LOOP
      INSERT INTO public.recurring_pdf_payment_occurrences (reminder_id, scheduled_for, amount, currency)
      VALUES (item.id, payment_date, (item.recurring_pdf->>'amount')::numeric, COALESCE(NULLIF(item.recurring_pdf->>'currency', ''), 'PLN'))
      ON CONFLICT (reminder_id, scheduled_for) DO NOTHING;
      payment_date := CASE payment_repeat
        WHEN 'weekly' THEN payment_date + interval '1 week'
        WHEN 'monthly' THEN payment_date + interval '1 month'
        WHEN 'yearly' THEN payment_date + interval '1 year'
        ELSE NULL
      END;
      EXIT WHEN payment_date IS NULL;
    END LOOP;

    UPDATE public.pdf_archive_entries
    SET amount = COALESCE((
      SELECT SUM(occurrence.amount)
      FROM public.recurring_pdf_payment_occurrences AS occurrence
      WHERE occurrence.reminder_id = item.id
    ), 0)
    WHERE id = source_entry_id AND user_id = item.user_id;
  END LOOP;
END;
$$;

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
  processed integer := 0;
BEGIN
  FOR item IN
    SELECT * FROM public.reminders
    WHERE closed_at IS NULL AND recurring_pdf IS NOT NULL
  LOOP
    payment_date := COALESCE(NULLIF(item.recurring_pdf->>'payment_start_date', '')::date, item.reminder_date);
    payment_repeat := COALESCE(NULLIF(item.recurring_pdf->>'payment_repeat', ''), item.repeat);
    source_entry_id := NULLIF(item.recurring_pdf->>'source_entry_id', '')::uuid;
    IF payment_date IS NULL OR source_entry_id IS NULL THEN CONTINUE; END IF;

    WHILE payment_date <= CURRENT_DATE LOOP
      INSERT INTO public.recurring_pdf_payment_occurrences (reminder_id, scheduled_for, amount, currency)
      VALUES (item.id, payment_date, (item.recurring_pdf->>'amount')::numeric, COALESCE(NULLIF(item.recurring_pdf->>'currency', ''), 'PLN'))
      ON CONFLICT (reminder_id, scheduled_for) DO NOTHING;
      payment_date := CASE payment_repeat
        WHEN 'weekly' THEN payment_date + interval '1 week'
        WHEN 'monthly' THEN payment_date + interval '1 month'
        WHEN 'yearly' THEN payment_date + interval '1 year'
        ELSE NULL
      END;
      EXIT WHEN payment_date IS NULL;
    END LOOP;

    UPDATE public.pdf_archive_entries
    SET amount = COALESCE((SELECT SUM(amount) FROM public.recurring_pdf_payment_occurrences WHERE reminder_id = item.id), 0)
    WHERE id = source_entry_id AND user_id = item.user_id;
  END LOOP;

  FOR item IN
    SELECT * FROM public.reminders
    WHERE closed_at IS NULL AND next_notification_at IS NOT NULL AND next_notification_at <= now()
    ORDER BY next_notification_at
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, is_read, metadata)
    VALUES (item.user_id, 'Напоминание: ' || item.full_name, item.message, 'reminder_alert', false,
      jsonb_build_object('reminder_id', item.id, 'contact', item.contact, 'scheduled_for', item.next_notification_at));
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
