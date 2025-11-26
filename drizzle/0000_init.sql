CREATE TABLE `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `improvement_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`current_iteration` integer DEFAULT 0 NOT NULL,
	`max_iterations` integer NOT NULL,
	`best_score` real,
	`best_prompt_content` text,
	`best_prompt_version_id` integer,
	`log` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`parent_version_id` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `test_cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prompt_id` integer NOT NULL,
	`input` text NOT NULL,
	`expected_output` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `test_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`total_tests` integer DEFAULT 0 NOT NULL,
	`completed_tests` integer DEFAULT 0 NOT NULL,
	`results` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `test_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`test_case_id` integer NOT NULL,
	`llm_provider` text NOT NULL,
	`run_number` integer NOT NULL,
	`actual_output` text,
	`is_correct` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
