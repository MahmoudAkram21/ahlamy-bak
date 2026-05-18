-- DropForeignKey
ALTER TABLE `requests` DROP FOREIGN KEY `requests_plan_id_fkey`;

-- BackfillData
UPDATE `notifications`
SET `type` = CASE
  WHEN `type` = 'dream_message' THEN 'request_message'
  WHEN `type` = 'dream_assigned' THEN 'request_assigned'
  WHEN `type` IN ('dream_submitted', 'dream_status_changed') THEN 'request_status_changed'
  ELSE `type`
END;

UPDATE `payments` p
JOIN `request_plan_purchases` rpp ON rpp.`payment_id` = p.`id`
SET p.`request_id` = rpp.`request_id`
WHERE p.`request_id` IS NULL;

UPDATE `payments`
SET `request_id` = ''
WHERE `request_id` IS NULL;

-- AlterTable
ALTER TABLE `chat_messages` MODIFY `content` TEXT NULL;

-- AlterTable
ALTER TABLE `dreams` DROP COLUMN `content`;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('admin_broadcast', 'request_message', 'request_paid', 'request_assigned', 'request_status_changed') NOT NULL;

-- AlterTable
ALTER TABLE `payments` MODIFY `request_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `requests` DROP COLUMN `notes`;
