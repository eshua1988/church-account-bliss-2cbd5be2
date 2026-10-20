-- The signing token is a single-use capability link for the leading pastor.
ALTER TABLE public.protocol_link_settings
  ADD COLUMN IF NOT EXISTS secretary_signature text;

ALTER TABLE public.protocol_documents
  ADD COLUMN IF NOT EXISTS pastor_sign_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS pastor_signed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS protocol_documents_pastor_sign_token_idx
  ON public.protocol_documents (pastor_sign_token);
