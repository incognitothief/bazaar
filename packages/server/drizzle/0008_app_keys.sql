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
