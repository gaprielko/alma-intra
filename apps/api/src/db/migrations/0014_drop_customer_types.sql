-- The records name their products in `customer_products` (0013): the single type goes.
ALTER TABLE "customers" DROP CONSTRAINT "customers_type_id_customer_types_id_fk";--> statement-breakpoint
DROP INDEX "customers_type_idx";--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "type_id";--> statement-breakpoint
DROP TABLE "customer_types";
