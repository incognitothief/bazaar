CREATE TABLE `inventory_prefill_log` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_did` text NOT NULL,
	`created_at` integer NOT NULL,
	`payload_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_prefill_merchant_created` ON `inventory_prefill_log` (`merchant_did`, `created_at`);
