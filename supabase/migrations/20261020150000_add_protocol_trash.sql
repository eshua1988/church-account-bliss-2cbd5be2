ALTER TABLE public.protocol_documents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS protocol_documents_trash_expiry_idx
  ON public.protocol_documents (link_token, deleted_at)
  WHERE deleted_at IS NOT NULL;
