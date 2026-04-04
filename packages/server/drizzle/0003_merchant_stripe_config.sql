CREATE TABLE `merchant_stripe_config` (
	`singleton` integer PRIMARY KEY NOT NULL DEFAULT 1 CHECK (`singleton` = 1),
	`stripe_secret_key` text,
	`stripe_webhook_secret` text,
	`updated_at` integer NOT NULL
);
