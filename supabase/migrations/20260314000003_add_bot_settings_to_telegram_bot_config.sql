-- Add bot_settings column to telegram_bot_config
ALTER TABLE telegram_bot_config
  ADD COLUMN IF NOT EXISTS bot_settings jsonb DEFAULT '{"language":"ru","disableNotifications":false,"deleteOldMessages":true,"sessionTimeout":6}'::jsonb;
