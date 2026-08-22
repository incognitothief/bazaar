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
