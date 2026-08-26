INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-branding',
  'app-branding',
  true,
  1048576,
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 1048576,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Anyone can view app branding icons'
  ) THEN
    CREATE POLICY "Anyone can view app branding icons"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'app-branding');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can upload their own app branding icons'
  ) THEN
    CREATE POLICY "Users can upload their own app branding icons"
    ON storage.objects
    FOR INSERT
    WITH CHECK (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can update their own app branding icons'
  ) THEN
    CREATE POLICY "Users can update their own app branding icons"
    ON storage.objects
    FOR UPDATE
    USING (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1])
    WITH CHECK (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Users can delete their own app branding icons'
  ) THEN
    CREATE POLICY "Users can delete their own app branding icons"
    ON storage.objects
    FOR DELETE
    USING (bucket_id = 'app-branding' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;
