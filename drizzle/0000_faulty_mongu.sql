CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`alternate_title` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'watchlist' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`total_units` integer,
	`unit_label` text DEFAULT 'episodes' NOT NULL,
	`rating` real,
	`review` text,
	`notes` text,
	`overview` text,
	`poster_url` text,
	`backdrop_url` text,
	`release_date` text,
	`reminder_date` text,
	`genres` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`provider` text,
	`provider_id` text,
	`external_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_items_type_idx` ON `media_items` (`type`);--> statement-breakpoint
CREATE INDEX `media_items_status_idx` ON `media_items` (`status`);--> statement-breakpoint
CREATE INDEX `media_items_updated_at_idx` ON `media_items` (`updated_at`);--> statement-breakpoint
CREATE INDEX `media_items_reminder_date_idx` ON `media_items` (`reminder_date`);--> statement-breakpoint
