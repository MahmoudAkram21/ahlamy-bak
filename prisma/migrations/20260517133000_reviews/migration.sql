CREATE TABLE `reviews` (
  `id` VARCHAR(191) NOT NULL,
  `reviewer_name` VARCHAR(255) NOT NULL,
  `content` TEXT NOT NULL,
  `rating` INTEGER NOT NULL DEFAULT 5,
  `source` VARCHAR(100) NULL,
  `is_featured` BOOLEAN NOT NULL DEFAULT false,
  `is_published` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `reviews_is_featured_is_published_created_at_idx`(`is_featured`, `is_published`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
