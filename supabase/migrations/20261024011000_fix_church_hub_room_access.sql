-- Rooms created before this migration did not belong to a Hub workspace.
-- Attach them to the same membership boundary that protects Church Hub data.
ALTER TABLE public.hub_members
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS department text;

UPDATE public.hub_members member
SET display_name = COALESCE(
  NULLIF(member.display_name, ''),
  NULLIF(auth_user.raw_user_meta_data ->> 'display_name', ''),
  split_part(auth_user.email, '@', 1)
)
FROM auth.users auth_user
WHERE auth_user.id = member.user_id;

ALTER TABLE public.church_hub_rooms
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.hub_workspaces(id) ON DELETE CASCADE;

UPDATE public.church_hub_rooms room
SET workspace_id = member.workspace_id
FROM public.hub_members member
WHERE member.user_id = room.owner_id
  AND room.workspace_id IS NULL;

ALTER TABLE public.church_hub_rooms
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS church_hub_rooms_workspace_name_key
  ON public.church_hub_rooms (workspace_id, name);

CREATE OR REPLACE FUNCTION public.church_hub_room_can_access(target_room uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.church_hub_rooms room
    WHERE room.id = target_room
      AND public.hub_is_member(room.workspace_id)
      AND (
        room.owner_id = auth.uid()
        OR room.access_mode = 'all'
        OR room.room_type = 'church'
        OR EXISTS (
          SELECT 1 FROM public.church_hub_room_members member
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
    SELECT 1 FROM public.church_hub_rooms room
    WHERE room.id = target_room
      AND (
        room.owner_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.church_hub_room_members member
          WHERE member.room_id = room.id
            AND member.user_id = auth.uid()
            AND member.role IN ('owner', 'leader')
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Room members can read rooms" ON public.church_hub_rooms;
DROP POLICY IF EXISTS "Owners create rooms" ON public.church_hub_rooms;
DROP POLICY IF EXISTS "Owners manage rooms" ON public.church_hub_rooms;
DROP POLICY IF EXISTS "Members can read room membership" ON public.church_hub_room_members;
DROP POLICY IF EXISTS "Room leaders manage membership" ON public.church_hub_room_members;
DROP POLICY IF EXISTS "Members read room messages" ON public.church_hub_room_messages;
DROP POLICY IF EXISTS "Members write room messages" ON public.church_hub_room_messages;

CREATE POLICY "Hub users can read permitted rooms" ON public.church_hub_rooms
  FOR SELECT TO authenticated USING (public.church_hub_room_can_access(id));
CREATE POLICY "Hub leaders create rooms" ON public.church_hub_rooms
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid() AND public.hub_is_leader(workspace_id));
CREATE POLICY "Room owners update rooms" ON public.church_hub_rooms
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Room owners delete rooms" ON public.church_hub_rooms
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "Permitted users read room membership" ON public.church_hub_room_members
  FOR SELECT TO authenticated USING (public.church_hub_room_can_access(room_id));
CREATE POLICY "Room managers manage membership" ON public.church_hub_room_members
  FOR ALL TO authenticated
  USING (public.church_hub_room_can_manage(room_id))
  WITH CHECK (public.church_hub_room_can_manage(room_id));

CREATE POLICY "Permitted users read messages" ON public.church_hub_room_messages
  FOR SELECT TO authenticated USING (public.church_hub_room_can_access(room_id));
CREATE POLICY "Permitted users send messages" ON public.church_hub_room_messages
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.church_hub_room_can_access(room_id));

CREATE OR REPLACE FUNCTION public.create_church_hub_default_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.church_hub_rooms (workspace_id, owner_id, name, room_type, access_mode)
  VALUES (NEW.id, NEW.owner_id, 'Церковь', 'church', 'all')
  ON CONFLICT (workspace_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_church_hub_default_room ON public.hub_workspaces;
CREATE TRIGGER create_church_hub_default_room
AFTER INSERT ON public.hub_workspaces
FOR EACH ROW EXECUTE FUNCTION public.create_church_hub_default_room();

INSERT INTO public.church_hub_rooms (workspace_id, owner_id, name, room_type, access_mode)
SELECT workspace.id, workspace.owner_id, 'Церковь', 'church', 'all'
FROM public.hub_workspaces workspace
ON CONFLICT (workspace_id, name) DO NOTHING;

GRANT EXECUTE ON FUNCTION public.church_hub_room_can_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.church_hub_room_can_manage(uuid) TO authenticated;
