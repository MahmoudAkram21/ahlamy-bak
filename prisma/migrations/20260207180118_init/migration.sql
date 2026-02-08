-- CreateTable
CREATE TABLE `interpreter_ratings` (
    `id` VARCHAR(191) NOT NULL,
    `dream_id` VARCHAR(191) NOT NULL,
    `interpreter_id` VARCHAR(191) NOT NULL,
    `dreamer_id` VARCHAR(191) NOT NULL,
    `rating` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `interpreter_ratings_dream_id_key`(`dream_id`),
    INDEX `interpreter_ratings_interpreter_id_idx`(`interpreter_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `interpreter_ratings` ADD CONSTRAINT `interpreter_ratings_dream_id_fkey` FOREIGN KEY (`dream_id`) REFERENCES `dreams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interpreter_ratings` ADD CONSTRAINT `interpreter_ratings_interpreter_id_fkey` FOREIGN KEY (`interpreter_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `interpreter_ratings` ADD CONSTRAINT `interpreter_ratings_dreamer_id_fkey` FOREIGN KEY (`dreamer_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
