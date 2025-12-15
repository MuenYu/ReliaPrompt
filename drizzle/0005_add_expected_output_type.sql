-- Migration: Add expected_output_type column to test_cases table
-- This allows test cases to specify the ParseType for expected outputs

-- Add the column with default value 'array' for existing records
ALTER TABLE `test_cases` ADD COLUMN `expected_output_type` text NOT NULL DEFAULT 'array';
--> statement-breakpoint

