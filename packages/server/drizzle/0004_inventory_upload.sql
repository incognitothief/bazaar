CREATE TABLE `inventory_upload_session` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_did` text NOT NULL,
	`inventory_kind` text DEFAULT 'digital' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`draft_json` text,
	`published_at` integer,
	`publish_error` text,
	`pds_snapshot_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
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
	`error` text,
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
