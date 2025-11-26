ALTER TABLE `prompts` ADD `prompt_group_id` integer;
--> statement-breakpoint
UPDATE `prompts` SET `prompt_group_id` = `id` WHERE `prompt_group_id` IS NULL;

