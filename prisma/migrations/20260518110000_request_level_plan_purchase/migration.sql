ALTER TABLE `requests`
  ADD COLUMN `plan_id` VARCHAR(191) NULL,
  ADD COLUMN `submission_type` ENUM('text', 'audio') NULL,
  ADD COLUMN `letter_quota_snapshot` INTEGER NULL,
  ADD COLUMN `voice_note_max_seconds_snapshot` INTEGER NULL,
  ADD COLUMN `draft_text` TEXT NULL,
  ADD COLUMN `draft_audio_url` VARCHAR(500) NULL,
  ADD COLUMN `draft_audio_duration` INTEGER NULL;

ALTER TABLE `payments`
  ADD COLUMN `request_id` VARCHAR(191) NULL;

CREATE TABLE `request_plan_purchases` (
  `id` VARCHAR(191) NOT NULL,
  `request_id` VARCHAR(191) NOT NULL,
  `plan_id` VARCHAR(191) NOT NULL,
  `payment_id` VARCHAR(191) NULL,
  `submission_type` ENUM('text', 'audio') NOT NULL,
  `letter_quota` INTEGER NOT NULL,
  `voice_note_max_seconds` INTEGER NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `request_plan_purchases_request_id_key`(`request_id`),
  UNIQUE INDEX `request_plan_purchases_payment_id_key`(`payment_id`),
  INDEX `request_plan_purchases_plan_id_idx`(`plan_id`),
  INDEX `request_plan_purchases_payment_id_idx`(`payment_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `payments_request_id_idx` ON `payments`(`request_id`);
CREATE INDEX `requests_plan_id_idx` ON `requests`(`plan_id`);
CREATE INDEX `requests_submission_type_idx` ON `requests`(`submission_type`);

ALTER TABLE `requests`
  ADD CONSTRAINT `requests_plan_id_fkey`
  FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `payments`
  ADD CONSTRAINT `payments_request_id_fkey`
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `request_plan_purchases`
  ADD CONSTRAINT `request_plan_purchases_request_id_fkey`
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `request_plan_purchases_plan_id_fkey`
  FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `request_plan_purchases_payment_id_fkey`
  FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
