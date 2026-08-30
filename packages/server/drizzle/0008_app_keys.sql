-- app_keys is a zero-authority cache: reconcileMerchantKeys() truncates and repopulates it from
-- the environment on every boot, so dropping it can never lose data. The DROP makes this
-- migration self-healing for databases that applied an earlier column shape of 0008 during
-- ADR 0013 iteration.
DROP TABLE IF EXISTS `app_keys`;
--> statement-breakpoint
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
