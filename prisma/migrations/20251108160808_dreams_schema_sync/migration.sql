-- AlterTable dreams: align with current schema (add new columns, drop notes)
ALTER TABLE `dreams`
  ADD COLUMN `plan_id` VARCHAR(191) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `metadata` JSON NULL,
  ADD COLUMN `audio_url` VARCHAR(500) NULL,
  ADD COLUMN `audio_duration` INTEGER NULL,
  ADD COLUMN `is_satisfied` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `satisfied_at` DATETIME(3) NULL,
  ADD COLUMN `vision_type` VARCHAR(20) NULL;

ALTER TABLE `dreams` DROP COLUMN `notes`;

CREATE INDEX `dreams_plan_id_idx` ON `dreams`(`plan_id`);

ALTER TABLE `dreams` ADD CONSTRAINT `dreams_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
