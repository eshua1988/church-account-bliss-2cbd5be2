-- Member-owned Church Hub profiles.  Access roles remain in `role`; the
-- visible ministry role is deliberately stored separately in `service_role`.
ALTER TABLE public.hub_members
  ADD COLUMN IF NOT EXISTS telegram_username text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS about text,
  ADD COLUMN IF NOT EXISTS service_role text;

ALTER TABLE public.hub_members
  ADD CONSTRAINT hub_members_about_length CHECK (about IS NULL OR char_length(about) <= 3000),
  ADD CONSTRAINT hub_members_telegram_format CHECK (telegram_username IS NULL OR telegram_username ~ '^[A-Za-z0-9_]{5,32}$');

-- Members can change only their public-profile fields.  A trigger makes the
-- restriction explicit, so the workspace access role cannot be escalated by
-- an ordinary member.
CREATE OR REPLACE FUNCTION public.hub_protect_member_access_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'Workspace membership cannot be changed from a profile update';
  END IF;
  IF OLD.role IS DISTINCT FROM NEW.role
     AND NOT public.hub_is_leader(OLD.workspace_id) THEN
    RAISE EXCEPTION 'Only an administrator can change an access role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hub_protect_member_access_fields ON public.hub_members;
CREATE TRIGGER hub_protect_member_access_fields
BEFORE UPDATE ON public.hub_members
FOR EACH ROW EXECUTE FUNCTION public.hub_protect_member_access_fields();

DROP POLICY IF EXISTS "Members update own profile" ON public.hub_members;
CREATE POLICY "Members update own profile" ON public.hub_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- A private bucket for profile photos.  The application stores files as
-- <workspace id>/<member id>/<file name> and exposes short-lived URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'church-hub-profile-photos',
  'church-hub-profile-photos',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "Hub members upload own profile photo" ON storage.objects;
CREATE POLICY "Hub members upload own profile photo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'church-hub-profile-photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
    AND public.hub_is_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Hub members read profile photos" ON storage.objects;
CREATE POLICY "Hub members read profile photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'church-hub-profile-photos'
    AND public.hub_is_member((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS "Members delete own profile photo" ON storage.objects;
CREATE POLICY "Members delete own profile photo" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'church-hub-profile-photos' AND (storage.foldername(name))[2] = auth.uid()::text);

-- The People page uses this RPC for a profile and all rooms/department rooms
-- where that person is a member.  A caller must belong to the same workspace.
CREATE OR REPLACE FUNCTION public.hub_person_profile(target_workspace_id uuid, target_user_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  department text,
  service_role text,
  telegram_username text,
  phone text,
  email text,
  avatar_url text,
  about text,
  groups jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT member.user_id, member.display_name, member.department,
    member.service_role, member.telegram_username, member.phone, member.email,
    member.avatar_url, member.about,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', room.id, 'name', room.name, 'department', room.department,
        'type', room.room_type, 'role', room_member.role
      ) ORDER BY room.name)
      FROM public.church_hub_room_members room_member
      JOIN public.church_hub_rooms room ON room.id = room_member.room_id
      WHERE room_member.user_id = member.user_id
        AND room.workspace_id = target_workspace_id
    ), '[]'::jsonb)
  FROM public.hub_members member
  WHERE member.workspace_id = target_workspace_id
    AND member.user_id = target_user_id
    AND public.hub_is_member(target_workspace_id);
$$;

-- Leaders/admins can remove a person from the workspace and their room
-- memberships.  The workspace owner may not be removed accidentally.
CREATE OR REPLACE FUNCTION public.hub_remove_member(target_workspace_id uuid, target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.hub_is_leader(target_workspace_id) THEN
    RAISE EXCEPTION 'Only an administrator or leader can remove people';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.hub_workspaces
    WHERE id = target_workspace_id AND owner_id = target_user_id
  ) THEN
    RAISE EXCEPTION 'The workspace owner cannot be removed';
  END IF;

  DELETE FROM public.church_hub_room_members rm
  USING public.church_hub_rooms room
  WHERE rm.room_id = room.id
    AND room.workspace_id = target_workspace_id
    AND rm.user_id = target_user_id;

  DELETE FROM public.hub_members
  WHERE workspace_id = target_workspace_id AND user_id = target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hub_person_profile(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_remove_member(uuid, uuid) TO authenticated;
