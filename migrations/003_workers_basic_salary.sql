-- Add basic salary to workers
ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS basic_salary NUMERIC;
