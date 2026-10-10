-- Keep only the source path as a lookup for the optional "open original PDF" action.
-- The accounting entry is still an independent database record and no PDF is moved or changed.
ALTER TABLE public.pdf_archive_entries
  ADD COLUMN IF NOT EXISTS source_pdf_path text;

-- Make existing independent archive entries able to open their original document
-- when the source notification still contains the storage path.
UPDATE public.pdf_archive_entries AS entry
SET source_pdf_path = notification.metadata->>'pdf_path'
FROM public.notifications AS notification
WHERE entry.source_notification_id = notification.id
  AND entry.source_pdf_path IS NULL
  AND NULLIF(notification.metadata->>'pdf_path', '') IS NOT NULL;
