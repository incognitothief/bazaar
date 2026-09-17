CREATE TABLE `app_keys` (
	`kid` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`public_key_multibase` text NOT NULL,
	`public_key_pem` text NOT NULL,
	`status` text NOT NULL,
	`superseded_by` text,
	`revoked` integer DEFAULT false NOT NULL,
	`first_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`uri` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`merchant_did` text NOT NULL,
	`title` text NOT NULL,
	`category` text,
	`description` text,
	`tags` text,
	`format` text,
	`file_checksum` text,
	`file_cid` text,
	`supersedes` text,
	`object_id` text,
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
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`object_id`) REFERENCES `inventory_upload_object`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_catalog_product_assets_product_uri` ON `catalog_product_assets` (`product_uri`);--> statement-breakpoint
CREATE TABLE `catalog_products` (
	`uri` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`merchant_did` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`tags` text,
	`items` text NOT NULL,
	`product_type` text,
	`art_included_in_download` integer DEFAULT false NOT NULL,
	`record_created_at` text,
	`captured_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`package_zip_key` text,
	`package_zip_status` text,
	`package_zip_updated_at` integer,
	`package_zip_rebuild_started_at` integer
);
--> statement-breakpoint
CREATE TABLE `inventory_upload_object` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`rkey` text NOT NULL,
	`role` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text,
	`byte_size` integer,
	`upload_kind` text DEFAULT 'single_put' NOT NULL,
	`s3_upload_id` text,
	`status` text DEFAULT 'initiated' NOT NULL,
	`r2_key` text NOT NULL,
	`file_checksum` text,
	`file_cid` text,
	`duration_ms` integer,
	`media_width` integer,
	`media_height` integer,
	`error` text,
	`webp_r2_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `inventory_upload_session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_upload_part` (
	`object_id` text NOT NULL,
	`part_number` integer NOT NULL,
	`etag` text NOT NULL,
	`size` integer,
	PRIMARY KEY(`object_id`, `part_number`),
	FOREIGN KEY (`object_id`) REFERENCES `inventory_upload_object`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_did` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`draft_json` text,
	`published_at` integer,
	`publish_error` text,
	`pds_snapshot_json` text,
	`product_rkey` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `licenses` (
	`cid` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`merchant_did` text NOT NULL,
	`title` text NOT NULL,
	`version` text NOT NULL,
	`license_text` text NOT NULL,
	`checkout_consent_required` integer NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `merchant_business_profile` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`business_name` text,
	`business_state` text,
	`business_email` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "merchant_business_profile_singleton" CHECK("merchant_business_profile"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `merchant_stripe_config` (
	`singleton` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`stripe_secret_key` text,
	`stripe_webhook_secret` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "merchant_stripe_config_singleton" CHECK("merchant_stripe_config"."singleton" = 1)
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_fulfillment` (
	`payment_intent_id` text PRIMARY KEY NOT NULL,
	`checkout_session_id` text,
	`buyer_did` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`receipt_uri` text,
	`receipt_cid` text,
	`item_uri` text,
	`listing_uri` text,
	`payload_snapshot` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
