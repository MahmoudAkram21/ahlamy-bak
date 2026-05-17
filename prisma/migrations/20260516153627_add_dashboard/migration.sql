/*
  Warnings:

  - You are about to drop the column `notes` on the `dreams` table. All the data in the column will be lost.
  - You are about to drop the column `audio_minutes_quota` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `country_codes` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `duration_days` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `max_dreams` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `max_interpretations` on the `plans` table. All the data in the column will be lost.
  - You are about to drop the column `scope` on the `plans` table. All the data in the column will be lost.
  - Made the column `plan_id` on table `payments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `letter_quota` on table `plans` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `payments` DROP FOREIGN KEY `payments_plan_id_fkey`;

-- AlterTable
ALTER TABLE `dreams` DROP COLUMN `notes`,
    ADD COLUMN `audio_duration` INTEGER NULL,
    ADD COLUMN `audio_url` VARCHAR(500) NULL,
    ADD COLUMN `description` TEXT NULL,
    ADD COLUMN `is_satisfied` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `metadata` JSON NULL,
    ADD COLUMN `plan_id` VARCHAR(191) NULL,
    ADD COLUMN `satisfied_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('new', 'pending_payment', 'pending_inquiry', 'pending_interpretation', 'interpreted', 'returned') NOT NULL DEFAULT 'new';

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `audio_url` VARCHAR(500) NULL,
    MODIFY `message_type` ENUM('text', 'interpretation', 'inquiry', 'audio') NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `dream_id` VARCHAR(191) NULL,
    MODIFY `plan_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `plans` DROP COLUMN `audio_minutes_quota`,
    DROP COLUMN `country_codes`,
    DROP COLUMN `duration_days`,
    DROP COLUMN `max_dreams`,
    DROP COLUMN `max_interpretations`,
    DROP COLUMN `scope`,
    MODIFY `letter_quota` INTEGER NOT NULL;

-- CreateTable
CREATE TABLE `dream_plan_purchases` (
    `id` VARCHAR(191) NOT NULL,
    `dream_id` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NOT NULL,
    `payment_id` VARCHAR(191) NOT NULL,
    `letter_quota` INTEGER NOT NULL,
    `letters_used` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dream_plan_purchases_dream_id_key`(`dream_id`),
    UNIQUE INDEX `dream_plan_purchases_payment_id_key`(`payment_id`),
    INDEX `dream_plan_purchases_plan_id_idx`(`plan_id`),
    INDEX `dream_plan_purchases_payment_id_idx`(`payment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `page_contents` (
    `id` VARCHAR(191) NOT NULL,
    `page_key` VARCHAR(100) NOT NULL,
    `title` VARCHAR(255) NULL,
    `content` TEXT NOT NULL,
    `metadata` JSON NULL,
    `is_published` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `page_contents_page_key_key`(`page_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `dreams_plan_id_idx` ON `dreams`(`plan_id`);

-- CreateIndex
CREATE INDEX `payments_dream_id_idx` ON `payments`(`dream_id`);

-- AddForeignKey
ALTER TABLE `dreams` ADD CONSTRAINT `dreams_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_dream_id_fkey` FOREIGN KEY (`dream_id`) REFERENCES `dreams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
