ALTER TABLE `prompts` ADD `evaluation_mode` text;--> statement-breakpoint
ALTER TABLE `prompts` ADD `evaluation_criteria` text;--> statement-breakpoint
ALTER TABLE `test_cases` ADD `evaluation_schema` text;