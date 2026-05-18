ALTER TABLE `plans`
  ADD COLUMN `supports_voice_notes` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `voice_note_max_seconds` INTEGER NULL;

ALTER TABLE `requests`
  MODIFY `status` ENUM('open', 'assigned', 'in_progress', 'closed', 'completed', 'cancelled', 'pending', 'accepted', 'rejected') NOT NULL DEFAULT 'open';

ALTER TABLE `chat_messages`
  MODIFY `message_type` ENUM('text', 'interpretation', 'inquiry', 'file', 'audio') NOT NULL DEFAULT 'text';

CREATE TABLE `interpreter_message_templates` (
  `id` VARCHAR(191) NOT NULL,
  `category` ENUM('opening', 'closing', 'general') NOT NULL,
  `content` TEXT NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `interpreter_message_templates_category_sort_order_idx`(`category`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
