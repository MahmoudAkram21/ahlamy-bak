-- AlterTable: align plans table with current schema (drop removed columns, make letter_quota NOT NULL)
UPDATE `plans` SET `letter_quota` = 0 WHERE `letter_quota` IS NULL;

ALTER TABLE `plans`
  DROP COLUMN `scope`,
  DROP COLUMN `country_codes`,
  DROP COLUMN `duration_days`,
  DROP COLUMN `max_dreams`,
  DROP COLUMN `max_interpretations`,
  DROP COLUMN `audio_minutes_quota`;

ALTER TABLE `plans` MODIFY COLUMN `letter_quota` INTEGER NOT NULL;
