ALTER TABLE `users` ADD COLUMN `deleted_at` DATETIME(3) NULL;
ALTER TABLE `profiles` ADD COLUMN `deleted_at` DATETIME(3) NULL;
ALTER TABLE `dreams` ADD COLUMN `deleted_at` DATETIME(3) NULL;
ALTER TABLE `plans` ADD COLUMN `deleted_at` DATETIME(3) NULL;

CREATE INDEX `profiles_deleted_at_idx` ON `profiles`(`deleted_at`);
CREATE INDEX `dreams_deleted_at_idx` ON `dreams`(`deleted_at`);
CREATE INDEX `plans_deleted_at_idx` ON `plans`(`deleted_at`);
