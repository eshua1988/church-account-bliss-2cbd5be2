-- A server-side history lets every signed-in device show the same most recent
-- synchronization result. Report details deliberately never contain tokens.
CREATE TABLE IF NOT EXISTS public.sync_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  trigger_source text NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'scheduled')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS sync_reports_user_completed_idx
  ON public.sync_reports (user_id, completed_at DESC);

ALTER TABLE public.sync_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own sync reports" ON public.sync_reports;
CREATE POLICY "Users read their own sync reports"
  ON public.sync_reports FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create their own sync reports" ON public.sync_reports;
CREATE POLICY "Users create their own sync reports"
  ON public.sync_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.sync_reports FROM anon;
GRANT SELECT, INSERT ON public.sync_reports TO authenticated;
GRANT ALL ON public.sync_reports TO service_role;

ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_reports;
