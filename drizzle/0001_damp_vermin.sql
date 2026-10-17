CREATE TABLE `app_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_limits` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_limits_expires_at_idx` ON `request_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`route` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_events_type_idx` ON `security_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `security_events_created_at_idx` ON `security_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `media_items` ADD `tier` text DEFAULT 'unranked' NOT NULL;