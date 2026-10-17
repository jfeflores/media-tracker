ALTER TABLE `media_items` ADD `description_source` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `community_rating` real;--> statement-breakpoint
ALTER TABLE `media_items` ADD `rating_source` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `rating_votes` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `imdb_id` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `mal_id` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `metadata_sources` text DEFAULT '[]' NOT NULL;