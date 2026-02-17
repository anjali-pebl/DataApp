ALTER TABLE processing_runs
  ADD COLUMN IF NOT EXISTS process_pid INTEGER;
