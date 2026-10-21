-- A protocol link remains the entry point, but each signed-in protocol
-- account receives an independent workspace behind that link.
ALTER TABLE public.protocol_documents
  DROP CONSTRAINT IF EXISTS protocol_documents_link_token_fkey;

ALTER TABLE public.protocol_link_settings
  DROP CONSTRAINT IF EXISTS protocol_link_settings_pkey;

ALTER TABLE public.protocol_link_settings
  ADD CONSTRAINT protocol_link_settings_pkey PRIMARY KEY (link_token, owner_user_id);

ALTER TABLE public.protocol_link_settings
  ADD COLUMN IF NOT EXISTS google_drive_client_id text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS protocol_documents_link_owner_created_idx
  ON public.protocol_documents (link_token, owner_user_id, archived, created_at DESC);

CREATE INDEX IF NOT EXISTS protocol_documents_link_owner_trash_idx
  ON public.protocol_documents (link_token, owner_user_id, deleted_at)
  WHERE deleted_at IS NOT NULL;
