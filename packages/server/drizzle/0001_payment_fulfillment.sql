CREATE TABLE `payment_fulfillment` (
	`payment_intent_id` text PRIMARY KEY NOT NULL,
	`checkout_session_id` text,
	`status` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`receipt_uri` text,
	`receipt_cid` text,
	`consent_uri` text,
	`payload_snapshot` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
