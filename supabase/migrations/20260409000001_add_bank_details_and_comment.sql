-- Add bank detail fields (tytuł, nadawca, odbiorca) and user-editable department_name + comment
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_sender TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_recipient TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bank_title TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS department_name TEXT DEFAULT NULL;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT NULL;
