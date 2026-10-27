alter table public.protocol_link_settings
  add column if not exists church_header_text_style text not null default 'regular',
  add column if not exists church_header_font_size integer not null default 20;
