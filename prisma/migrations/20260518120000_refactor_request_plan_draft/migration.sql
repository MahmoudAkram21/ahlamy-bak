-- DropForeignKey
ALTER TABLE `dream_plan_purchases` DROP FOREIGN KEY `dream_plan_purchases_dream_id_fkey`;

-- DropForeignKey
ALTER TABLE `dream_plan_purchases` DROP FOREIGN KEY `dream_plan_purchases_payment_id_fkey`;

-- DropForeignKey
ALTER TABLE `dream_plan_purchases` DROP FOREIGN KEY `dream_plan_purchases_plan_id_fkey`;

-- DropForeignKey
ALTER TABLE `dreams` DROP FOREIGN KEY `dreams_interpreter_id_fkey`;

-- DropForeignKey
ALTER TABLE `dreams` DROP FOREIGN KEY `dreams_plan_id_fkey`;

-- DropForeignKey
ALTER TABLE `messages` DROP FOREIGN KEY `messages_dream_id_fkey`;

-- DropForeignKey
ALTER TABLE `messages` DROP FOREIGN KEY `messages_sender_id_fkey`;

-- DropForeignKey
ALTER TABLE `payments` DROP FOREIGN KEY `payments_request_id_fkey`;

-- DropForeignKey
ALTER TABLE `profiles` DROP FOREIGN KEY `profiles_current_plan_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_plans` DROP FOREIGN KEY `user_plans_plan_id_fkey`;

-- DropForeignKey
ALTER TABLE `user_plans` DROP FOREIGN KEY `user_plans_user_id_fkey`;

-- DropIndex
DROP INDEX `dreams_interpreter_id_idx` ON `dreams`;

-- DropIndex
DROP INDEX `dreams_plan_id_idx` ON `dreams`;

-- DropIndex
DROP INDEX `dreams_status_idx` ON `dreams`;

-- DropIndex
DROP INDEX `profiles_current_plan_id_fkey` ON `profiles`;

-- DropIndex
DROP INDEX `requests_submission_type_idx` ON `requests`;

-- BackfillData
UPDATE `chat_messages`
SET `message_type` = 'text'
WHERE `message_type` IN ('interpretation', 'inquiry', 'file');

UPDATE `requests`
SET `submission_type` = 'text'
WHERE `submission_type` IS NULL;

UPDATE `requests`
SET `status` = CASE
  WHEN `status` = 'pending' THEN 'pending_payment'
  WHEN `status` = 'assigned' THEN 'in_progress'
  WHEN `status` = 'accepted' THEN 'in_progress'
  WHEN `status` = 'completed' THEN 'closed'
  WHEN `status` = 'rejected' THEN 'cancelled'
  ELSE `status`
END;

-- AlterTable
ALTER TABLE `chat_messages` MODIFY `message_type` ENUM('text', 'audio') NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE `dreams` DROP COLUMN `audio_duration`,
    DROP COLUMN `audio_url`,
    DROP COLUMN `interpretation`,
    DROP COLUMN `interpreter_id`,
    DROP COLUMN `is_satisfied`,
    DROP COLUMN `plan_id`,
    DROP COLUMN `satisfied_at`,
    DROP COLUMN `status`;

-- AlterTable
ALTER TABLE `profiles` DROP COLUMN `current_plan_id`;

-- AlterTable
ALTER TABLE `request_plan_purchases` ADD COLUMN `letters_used` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `requests` DROP COLUMN `budget`,
    DROP COLUMN `description`,
    DROP COLUMN `draft_audio_duration`,
    DROP COLUMN `draft_audio_url`,
    DROP COLUMN `draft_text`,
    DROP COLUMN `title`,
    ADD COLUMN `draft_audio_path` VARCHAR(500) NULL,
    ADD COLUMN `draft_text_content` TEXT NULL,
    ADD COLUMN `is_satisfied` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `satisfied_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('pending_payment', 'open', 'in_progress', 'closed', 'cancelled') NOT NULL DEFAULT 'pending_payment',
    MODIFY `submission_type` ENUM('text', 'audio') NOT NULL;

-- DropTable
DROP TABLE `dream_plan_purchases`;

-- DropTable
DROP TABLE `messages`;

-- DropTable
DROP TABLE `user_plans`;

-- CreateIndex
CREATE INDEX `requests_status_idx` ON `requests`(`status`);

-- RedefineIndex
CREATE INDEX `requests_dream_id_idx` ON `requests`(`dream_id`);
SET @drop_requests_dream_id_fkey = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'requests'
        AND index_name = 'requests_dream_id_fkey'
    ),
    'DROP INDEX `requests_dream_id_fkey` ON `requests`',
    'SELECT 1'
  )
);
PREPARE drop_requests_dream_id_fkey_stmt FROM @drop_requests_dream_id_fkey;
EXECUTE drop_requests_dream_id_fkey_stmt;
DEALLOCATE PREPARE drop_requests_dream_id_fkey_stmt;

-- RedefineIndex
CREATE INDEX `requests_dreamer_id_idx` ON `requests`(`dreamer_id`);
SET @drop_requests_dreamer_id_fkey = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'requests'
        AND index_name = 'requests_dreamer_id_fkey'
    ),
    'DROP INDEX `requests_dreamer_id_fkey` ON `requests`',
    'SELECT 1'
  )
);
PREPARE drop_requests_dreamer_id_fkey_stmt FROM @drop_requests_dreamer_id_fkey;
EXECUTE drop_requests_dreamer_id_fkey_stmt;
DEALLOCATE PREPARE drop_requests_dreamer_id_fkey_stmt;

-- RedefineIndex
CREATE INDEX `requests_interpreter_id_idx` ON `requests`(`interpreter_id`);
SET @drop_requests_interpreter_id_fkey = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'requests'
        AND index_name = 'requests_interpreter_id_fkey'
    ),
    'DROP INDEX `requests_interpreter_id_fkey` ON `requests`',
    'SELECT 1'
  )
);
PREPARE drop_requests_interpreter_id_fkey_stmt FROM @drop_requests_interpreter_id_fkey;
EXECUTE drop_requests_interpreter_id_fkey_stmt;
DEALLOCATE PREPARE drop_requests_interpreter_id_fkey_stmt;
