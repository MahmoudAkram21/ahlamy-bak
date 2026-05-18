-- DropForeignKey
ALTER TABLE `comments` DROP FOREIGN KEY `comments_dream_id_fkey`;

-- DropForeignKey
ALTER TABLE `comments` DROP FOREIGN KEY `comments_user_id_fkey`;

-- DropTable
DROP TABLE `comments`;
