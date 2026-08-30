CREATE TABLE `app_keys` (
	`kid` text PRIMARY KEY NOT NULL,
	`public_key_multibase` text NOT NULL,
	`public_key_pem` text NOT NULL,
	`status` text NOT NULL,
	`superseded_by` text,
	`activated_at` text,
	`retired_at` text,
	`notes` text,
	`first_seen_at` integer NOT NULL,
	`last_verified_at` integer
);
