ALTER TABLE `interpreter_applications`
  MODIFY `status` ENUM('pending', 'resubmitted', 'approved', 'rejected') NOT NULL DEFAULT 'pending';
