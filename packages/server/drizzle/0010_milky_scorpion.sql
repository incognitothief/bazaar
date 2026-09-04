ALTER TABLE `catalog_products` ADD `product_type` text;--> statement-breakpoint
ALTER TABLE `catalog_products` ADD `art_included_in_download` integer DEFAULT false NOT NULL;