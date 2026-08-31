CREATE TABLE `catalog_items` (
	`uri` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`seller_did` text NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`description` text,
	`format` text,
	`file_checksum` text,
	`file_cid` text,
	`supersedes` text,
	`record_created_at` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_product_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_uri` text NOT NULL,
	`object_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`object_id`) REFERENCES `inventory_upload_object`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_product_assets_product_uri` ON `catalog_product_assets` (`product_uri`);--> statement-breakpoint
CREATE TABLE `catalog_products` (
	`uri` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`seller_did` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`items` text NOT NULL,
	`record_created_at` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
