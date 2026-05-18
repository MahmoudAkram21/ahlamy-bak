-- DropIndex
DROP INDEX `payments_dream_id_idx` ON `payments`;

-- AlterTable
ALTER TABLE `chat_messages`
    CHANGE COLUMN `file_url` `audio_url` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `payments`
    DROP COLUMN `dream_id`;

-- AlterTable
ALTER TABLE `requests`
    CHANGE COLUMN `draft_audio_path` `dream_description_audio_url` VARCHAR(500) NULL,
    CHANGE COLUMN `draft_text_content` `dream_description_text` TEXT NULL,
    DROP COLUMN `completed_at`,
    DROP COLUMN `letter_quota_snapshot`,
    DROP COLUMN `voice_note_max_seconds_snapshot`,
    MODIFY `status` ENUM('draft', 'pending_payment', 'paid', 'open', 'in_progress', 'closed', 'cancelled') NOT NULL DEFAULT 'draft',
    MODIFY `submission_type` ENUM('text', 'audio') NULL;
