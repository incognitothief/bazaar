CREATE TABLE `merchant_business_profile` (
	`singleton` integer PRIMARY KEY NOT NULL DEFAULT 1 CHECK (`singleton` = 1),
	`business_name` text,
	`business_state` text,
	`business_email` text,
	`updated_at` integer NOT NULL
);
