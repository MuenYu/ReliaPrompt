-- Add score metrics columns for nuanced JSON comparison
-- Note: SQLite requires separate statements for each ALTER TABLE
ALTER TABLE test_results ADD COLUMN score REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE test_results ADD COLUMN expected_found INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE test_results ADD COLUMN expected_total INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE test_results ADD COLUMN unexpected_count INTEGER NOT NULL DEFAULT 0;
