CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`media_item_id` text,
	`actor_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_action_idx` ON `audit_events` (`action`);--> statement-breakpoint
CREATE INDEX `audit_events_created_at_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `metadata_provider_health` (
	`provider` text PRIMARY KEY NOT NULL,
	`state` text DEFAULT 'degraded' NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_status` integer,
	`last_error_code` text,
	`last_error_at` text,
	`last_success_at` text,
	`retry_after_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metadata_provider_health_state_idx` ON `metadata_provider_health` (`state`);--> statement-breakpoint
CREATE INDEX `metadata_provider_health_retry_idx` ON `metadata_provider_health` (`retry_after_at`);--> statement-breakpoint
ALTER TABLE `media_items` ADD `anilist_id` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `metadata_last_attempt_at` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `metadata_last_error_code` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `metadata_last_error_provider` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `metadata_retry_after_at` text;--> statement-breakpoint
CREATE INDEX `media_items_metadata_retry_idx` ON `media_items` (`metadata_retry_after_at`);