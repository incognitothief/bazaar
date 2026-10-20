CREATE TABLE `checkout_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_uri` text NOT NULL,
	`listing_cid` text NOT NULL,
	`listing_json` text NOT NULL,
	`item_uri` text NOT NULL,
	`item_cid` text,
	`item_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_checkout_snapshot_created_at` ON `checkout_snapshot` (`created_at`);