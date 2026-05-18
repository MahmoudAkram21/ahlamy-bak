-- BackfillData
UPDATE `dreams`
SET `description` = ''
WHERE `description` IS NULL;

-- AlterTable
ALTER TABLE `dreams` MODIFY `description` TEXT NOT NULL;

-- BackfillData
UPDATE `payments` p
SET p.`request_id` = (
  SELECT r.`id`
  FROM `requests` r
  WHERE r.`dreamer_id` = p.`user_id`
  ORDER BY r.`created_at` DESC
  LIMIT 1
)
WHERE NOT EXISTS (
  SELECT 1
  FROM `requests` existing_request
  WHERE existing_request.`id` = p.`request_id`
)
AND EXISTS (
  SELECT 1
  FROM `requests` matching_request
  WHERE matching_request.`dreamer_id` = p.`user_id`
);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `requests` ADD CONSTRAINT `requests_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
