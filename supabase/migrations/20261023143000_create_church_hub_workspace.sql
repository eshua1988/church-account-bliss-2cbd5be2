-- Church Hub is a separate application, but shares the same Supabase
-- project and identity provider with Church Account. Its data lives in
-- dedicated tables, therefore financial records never become public to Hub.

CREATE TABLE IF NOT EXISTS public.hub_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Моя церковь',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hub_members (
  workspace_id uuid NOT NULL REFERENCES public.hub_workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'leader', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

-- A versioned JSON document makes the first Hub release immediately useful
-- while the application grows into people, departments and planning tables.
CREATE TABLE IF NOT EXISTS public.hub_workspace_data (
  workspace_id uuid PRIMARY KEY REFERENCES public.hub_workspaces(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE OR REPLACE FUNCTION public.hub_is_member(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hub_members
    WHERE workspace_id = target_workspace_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.hub_is_leader(target_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hub_members
    WHERE workspace_id = target_workspace_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'leader')
  );
$$;

CREATE OR REPLACE FUNCTION public.hub_ensure_workspace()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_workspace_id uuid;
  new_workspace_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT workspace_id INTO existing_workspace_id
  FROM public.hub_members
  WHERE user_id = auth.uid()
  ORDER BY created_at
  LIMIT 1;

  IF existing_workspace_id IS NOT NULL THEN
    RETURN existing_workspace_id;
  END IF;

  INSERT INTO public.hub_workspaces (owner_id)
  VALUES (auth.uid())
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.hub_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, auth.uid(), 'owner');

  INSERT INTO public.hub_workspace_data (workspace_id, updated_by)
  VALUES (new_workspace_id, auth.uid());

  RETURN new_workspace_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hub_ensure_workspace() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_is_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_is_leader(uuid) TO authenticated;

ALTER TABLE public.hub_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_workspace_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hub members can view their workspaces"
ON public.hub_workspaces FOR SELECT TO authenticated
USING (public.hub_is_member(id));

CREATE POLICY "Hub owners can rename workspaces"
ON public.hub_workspaces FOR UPDATE TO authenticated
USING (owner_id = auth.uid())
WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Hub members can view members"
ON public.hub_members FOR SELECT TO authenticated
USING (public.hub_is_member(workspace_id));

CREATE POLICY "Hub leaders can add members"
ON public.hub_members FOR INSERT TO authenticated
WITH CHECK (public.hub_is_leader(workspace_id));

CREATE POLICY "Hub owners can change members"
ON public.hub_members FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.hub_workspaces workspace
  WHERE workspace.id = workspace_id AND workspace.owner_id = auth.uid()
));

CREATE POLICY "Hub owners can remove members"
ON public.hub_members FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.hub_workspaces workspace
  WHERE workspace.id = workspace_id AND workspace.owner_id = auth.uid()
));

CREATE POLICY "Hub members can view workspace data"
ON public.hub_workspace_data FOR SELECT TO authenticated
USING (public.hub_is_member(workspace_id));

CREATE POLICY "Hub leaders can update workspace data"
ON public.hub_workspace_data FOR UPDATE TO authenticated
USING (public.hub_is_leader(workspace_id))
WITH CHECK (public.hub_is_leader(workspace_id));

CREATE TRIGGER update_hub_workspaces_updated_at
BEFORE UPDATE ON public.hub_workspaces
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_hub_workspace_data_updated_at
BEFORE UPDATE ON public.hub_workspace_data
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
