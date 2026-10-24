-- Test administrator for Church Hub only. This does not grant access to Church Finances tables or policies.
ALTER TABLE public.hub_members
  DROP CONSTRAINT IF EXISTS hub_members_role_check;

ALTER TABLE public.hub_members
  ADD CONSTRAINT hub_members_role_check
  CHECK (role IN ('owner', 'admin', 'leader', 'member'));

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
      AND role IN ('owner', 'admin', 'leader')
  );
$$;

INSERT INTO public.hub_members (workspace_id, user_id, role)
SELECT workspace.id, account.id, 'admin'
FROM public.hub_workspaces AS workspace
JOIN auth.users AS account ON lower(account.email) = 'eshua1988@gmail.com'
ON CONFLICT (workspace_id, user_id)
DO UPDATE SET role = 'admin';

CREATE OR REPLACE FUNCTION public.church_hub_room_can_access(target_room uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.church_hub_rooms AS room
    WHERE room.id = target_room
      AND public.hub_is_member(room.workspace_id)
      AND (
        public.hub_is_leader(room.workspace_id)
        OR room.owner_id = auth.uid()
        OR room.access_mode = 'all'
        OR room.room_type = 'church'
        OR EXISTS (
          SELECT 1 FROM public.church_hub_room_members AS member
          WHERE member.room_id = room.id AND member.user_id = auth.uid()
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.church_hub_room_can_manage(target_room uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.church_hub_rooms AS room
    WHERE room.id = target_room
      AND public.hub_is_leader(room.workspace_id)
  );
$$;

DROP POLICY IF EXISTS "Room owners update rooms" ON public.church_hub_rooms;
CREATE POLICY "Room owners update rooms" ON public.church_hub_rooms
  FOR UPDATE TO authenticated
  USING (public.church_hub_room_can_manage(id))
  WITH CHECK (public.church_hub_room_can_manage(id));

DROP POLICY IF EXISTS "Room owners delete rooms" ON public.church_hub_rooms;
CREATE POLICY "Room owners delete rooms" ON public.church_hub_rooms
  FOR DELETE TO authenticated
  USING (public.church_hub_room_can_manage(id));

GRANT EXECUTE ON FUNCTION public.hub_is_leader(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.church_hub_room_can_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.church_hub_room_can_manage(uuid) TO authenticated;