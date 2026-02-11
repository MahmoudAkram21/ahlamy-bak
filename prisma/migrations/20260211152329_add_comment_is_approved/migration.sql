-- AlterTable
ALTER TABLE `comments` ADD COLUMN `is_approved` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `comments_is_approved_idx` ON `comments`(`is_approved`);
