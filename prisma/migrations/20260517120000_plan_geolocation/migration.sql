ALTER TABLE `plans`
  ADD COLUMN `scope` ENUM('egypt', 'international', 'custom') NOT NULL DEFAULT 'egypt',
  ADD COLUMN `country_codes` JSON NULL;

UPDATE `plans`
SET `country_codes` = JSON_ARRAY()
WHERE `country_codes` IS NULL;

ALTER TABLE `plans`
  MODIFY COLUMN `country_codes` JSON NOT NULL;
