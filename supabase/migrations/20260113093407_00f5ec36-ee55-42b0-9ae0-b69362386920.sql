-- Add spreadsheet_id column to profiles table for personal Google Sheets
ALTER TABLE public.profiles 
ADD COLUMN spreadsheet_id text,
ADD COLUMN sheet_range text DEFAULT '''Data app''!A:G';