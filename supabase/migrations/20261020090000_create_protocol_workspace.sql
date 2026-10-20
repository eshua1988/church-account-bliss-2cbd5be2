-- Public protocol links act as a capability token.  Documents are kept
-- server-side so the protocol workspace works across browsers and devices.
CREATE TABLE IF NOT EXISTS public.protocol_link_settings (
  link_token text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  attendees jsonb NOT NULL DEFAULT '[]'::jsonb,
  secretary_name text NOT NULL DEFAULT '',
  pastor_name text NOT NULL DEFAULT '',
  google_sheet_url text NOT NULL DEFAULT '',
  cloud_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.protocol_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_token text NOT NULL REFERENCES public.protocol_link_settings(link_token) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  council text NOT NULL CHECK (council IN ('elders', 'church')),
  protocol_date date NOT NULL,
  protocol_time time,
  place text NOT NULL DEFAULT '',
  present jsonb NOT NULL DEFAULT '[]'::jsonb,
  absent jsonb NOT NULL DEFAULT '[]'::jsonb,
  content text NOT NULL,
  secretary_name text NOT NULL DEFAULT '',
  pastor_name text NOT NULL DEFAULT '',
  secretary_signature text,
  pastor_signature text,
  pdf_path text NOT NULL,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS protocol_documents_token_created_idx
  ON public.protocol_documents(link_token, archived, created_at DESC);

ALTER TABLE public.protocol_link_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage protocol settings"
  ON public.protocol_link_settings FOR ALL
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Owners manage protocol documents"
  ON public.protocol_documents FOR ALL
  USING (auth.uid() = owner_user_id) WITH CHECK (auth.uid() = owner_user_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('protocol-documents', 'protocol-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Owners manage stored protocol PDFs"
  ON storage.objects FOR ALL
  USING (bucket_id = 'protocol-documents' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'protocol-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
