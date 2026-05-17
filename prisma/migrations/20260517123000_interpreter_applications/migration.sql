CREATE TABLE `interpreter_applications` (
  `id` VARCHAR(191) NOT NULL,
  `full_name` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(50) NULL,
  `city` VARCHAR(100) NOT NULL DEFAULT 'Cairo',
  `country_code` VARCHAR(2) NOT NULL DEFAULT 'EG',
  `bio` TEXT NULL,
  `qualifications` TEXT NULL,
  `experience_years` INTEGER NOT NULL DEFAULT 0,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `notes` TEXT NULL,
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `interpreter_applications_email_key`(`email`),
  INDEX `interpreter_applications_status_created_at_idx`(`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
