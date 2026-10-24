CREATE TABLE IF NOT EXISTS public.church_hub_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  telegram_username text NOT NULL,
  name text NOT NULL,
  department text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

ALTER TABLE public.church_hub_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inviters manage their Church Hub invitations"
  ON public.church_hub_invitations FOR ALL
  USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);
