ALTER TABLE `prompts` ADD `optimizer_model_provider` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `optimizer_model_id` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `optimizer_max_iterations` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `prompts` ADD `optimizer_score_threshold` real;--> statement-breakpoint
ALTER TABLE `test_results` ADD `optimization_iteration` integer DEFAULT 0 NOT NULL;