-- Upgrade the first PDF-reminder cards created before recurring_pdf existed.
-- Those cards already carry an archive attachment and monthly repeat setting.
WITH matching_pdf AS (
  SELECT DISTINCT ON (reminder.id)
    reminder.id AS reminder_id,
    entry.amount,
    entry.currency,
    entry.category_id,
    entry.department_name,
    entry.basis,
    entry.issued_to,
    entry.source_pdf_path
  FROM public.reminders AS reminder
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(reminder.attachments, '[]'::jsonb)) AS attachment(value)
  JOIN public.pdf_archive_entries AS entry
    ON entry.user_id = reminder.user_id
   AND entry.source_pdf_path = attachment.value->>'path'
  WHERE reminder.recurring_pdf IS NULL
    AND reminder.closed_at IS NULL
    AND reminder.repeat = 'monthly'
    AND attachment.value->>'source' = 'archive'
  ORDER BY reminder.id, entry.document_date DESC, entry.created_at DESC
), updated AS (
  UPDATE public.reminders AS reminder
  SET recurring_pdf = jsonb_build_object(
    'amount', matching_pdf.amount,
    'currency', matching_pdf.currency,
    'category_id', COALESCE(matching_pdf.category_id, ''),
    'department_name', COALESCE(matching_pdf.department_name, ''),
    'basis', COALESCE(matching_pdf.basis, ''),
    'issued_to', COALESCE(matching_pdf.issued_to, reminder.full_name),
    'source_pdf_path', matching_pdf.source_pdf_path
  )
  FROM matching_pdf
  WHERE reminder.id = matching_pdf.reminder_id
  RETURNING reminder.*
)
INSERT INTO public.pdf_archive_entries (
  user_id, source_reminder_id, scheduled_for, receipt_index,
  type, amount, currency, category_id, department_name, basis,
  issued_to, source_pdf_path, document_date
)
SELECT
  reminder.user_id,
  reminder.id,
  reminder.reminder_date,
  0,
  'expense',
  (reminder.recurring_pdf->>'amount')::numeric,
  COALESCE(NULLIF(reminder.recurring_pdf->>'currency', ''), 'PLN'),
  NULLIF(reminder.recurring_pdf->>'category_id', ''),
  NULLIF(reminder.recurring_pdf->>'department_name', ''),
  NULLIF(reminder.recurring_pdf->>'basis', ''),
  COALESCE(NULLIF(reminder.recurring_pdf->>'issued_to', ''), reminder.full_name),
  NULLIF(reminder.recurring_pdf->>'source_pdf_path', ''),
  reminder.reminder_date
FROM updated AS reminder
WHERE reminder.reminder_date <= CURRENT_DATE
ON CONFLICT DO NOTHING;
