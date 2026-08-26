-- Create profile rows for any auth users that don't have one yet
INSERT INTO public.profiles (user_id, email, display_name)
SELECT 
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'display_name', u.email, 'User')
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
