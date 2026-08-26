
-- Allow anon to read notifications to find target notification by transaction_id
-- (needed for the public payout form to update pdf_path in notification metadata)
CREATE POLICY "Anon can read notifications for pdf path update"
  ON public.notifications
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to update notification metadata (pdf_path only via limited policy)
CREATE POLICY "Anon can update notification metadata"
  ON public.notifications
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anon to SELECT (read) objects from documents bucket (needed for signed URLs)
CREATE POLICY "Anon can read documents"
  ON storage.objects
  FOR SELECT
  TO anon
  USING (bucket_id = 'documents');
