-- A reminder created from an archived payout PDF can represent a continuing
-- monthly decision.  Keep the source document once, while creating a separate
-- accounting row for every scheduled monthly payment.
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS recurring_pdf jsonb,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE public.pdf_archive_entries
  ADD COLUMN IF NOT EXISTS source_reminder_id uuid REFERENCES public.reminders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS scheduled_for date;

CREATE UNIQUE INDEX IF NOT EXISTS pdf_archive_entries_reminder_month_idx
  ON public.pdf_archive_entries (source_reminder_id, scheduled_for)
  WHERE source_reminder_id IS NOT NULL;

-- Replaces the original scheduler. A recurring-PDF reminder produces one PDF
-- archive transaction for every elapsed monthly payment date, even if the app
-- was closed at that time. The source PDF remains a single storage object.
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
  processed integer := 0;
BEGIN
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

    IF item.recurring_pdf IS NOT NULL AND item.repeat = 'monthly' THEN
      scheduled_at := item.next_notification_at;
      WHILE scheduled_at <= now() LOOP
        INSERT INTO public.pdf_archive_entries (
          user_id, source_reminder_id, scheduled_for, receipt_index,
          type, amount, currency, category_id, department_name, basis,
          issued_to, source_pdf_path, document_date
        ) VALUES (
          item.user_id,
          item.id,
          (scheduled_at AT TIME ZONE 'Europe/Warsaw')::date,
          0,
          'expense',
          (item.recurring_pdf->>'amount')::numeric,
          COALESCE(NULLIF(item.recurring_pdf->>'currency', ''), 'PLN'),
          NULLIF(item.recurring_pdf->>'category_id', ''),
          NULLIF(item.recurring_pdf->>'department_name', ''),
          NULLIF(item.recurring_pdf->>'basis', ''),
          COALESCE(NULLIF(item.recurring_pdf->>'issued_to', ''), item.full_name),
          NULLIF(item.recurring_pdf->>'source_pdf_path', ''),
          (scheduled_at AT TIME ZONE 'Europe/Warsaw')::date
        ) ON CONFLICT DO NOTHING;
        scheduled_at := scheduled_at + interval '1 month';
      END LOOP;
      next_at := scheduled_at;
    ELSIF item.repeat = 'once' THEN
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
