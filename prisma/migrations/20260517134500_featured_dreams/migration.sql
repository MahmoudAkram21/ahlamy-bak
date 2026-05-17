ALTER TABLE `dreams`
  ADD COLUMN `is_featured` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `featured_at` DATETIME(3) NULL;

CREATE INDEX `dreams_is_featured_featured_at_idx` ON `dreams`(`is_featured`, `featured_at`);
