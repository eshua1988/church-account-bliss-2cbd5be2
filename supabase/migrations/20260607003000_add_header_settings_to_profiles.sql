ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS header_settings jsonb;

COMMENT ON COLUMN public.profiles.header_settings IS 'Per-user app header, PWA shortcut name, and icon branding settings.';
