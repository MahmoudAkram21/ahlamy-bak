/*
  Warnings:

  - Made the column `plan_id` on table `payments` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE `payments` DROP FOREIGN KEY `payments_plan_id_fkey`;

-- AlterTable
ALTER TABLE `chat_messages` ADD COLUMN `edited_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `dreams` MODIFY `status` ENUM('new', 'pending_payment', 'pending_inquiry', 'pending_interpretation', 'interpreted', 'returned') NOT NULL DEFAULT 'new';

-- AlterTable
ALTER TABLE `messages` ADD COLUMN `audio_url` VARCHAR(500) NULL,
    MODIFY `message_type` ENUM('text', 'interpretation', 'inquiry', 'audio') NOT NULL DEFAULT 'text';

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `dream_id` VARCHAR(191) NULL,
    MODIFY `plan_id` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `requests` MODIFY `status` ENUM('open', 'assigned', 'in_progress', 'completed', 'cancelled', 'pending', 'accepted', 'rejected', 'returned') NOT NULL DEFAULT 'open';

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
CREATE INDEX `payments_dream_id_idx` ON `payments`(`dream_id`);

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_dream_id_fkey` FOREIGN KEY (`dream_id`) REFERENCES `dreams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dream_plan_purchases` ADD CONSTRAINT `dream_plan_purchases_payment_id_fkey` FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
