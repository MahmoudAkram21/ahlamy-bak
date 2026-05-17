ALTER TABLE `notifications`
  MODIFY COLUMN `type` ENUM(
    'admin_broadcast',
    'dream_assigned',
    'dream_message',
    'dream_submitted',
    'dream_status_changed',
    'request_assigned',
    'request_status_changed'
  ) NOT NULL;
