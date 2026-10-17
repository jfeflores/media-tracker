ALTER TABLE `media_items` ADD `released_season_count` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `completed_seasons` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `completed_movies` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `franchise_installments` text DEFAULT '[]' NOT NULL;