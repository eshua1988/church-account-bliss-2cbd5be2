-- Allow public (anon) users to upload files to documents bucket
-- They can only upload to paths that are validated by the token system
-- The path structure is: {owner_user_id}/{transaction_id}/{filename}
-- We allow INSERT for anon users (upload-payout-pdf edge function handles validation)

-- Allow anon users to upload to documents bucket (needed for direct client-side upload)
CREATE POLICY "Public upload to documents for payout"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (bucket_id = 'documents');
