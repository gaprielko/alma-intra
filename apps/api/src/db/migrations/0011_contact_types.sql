CREATE TABLE "contact_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"system_key" text
);
--> statement-breakpoint
-- The list holds partners and suppliers too: every record gets a contact type, and the records
-- so far are customers.
INSERT INTO "contact_types" ("name", "position", "system_key")
VALUES ('Zákazník', 1, 'customer'), ('Partner', 2, NULL), ('Dodávateľ', 3, NULL), ('Spolupracovník', 4, NULL);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "contact_type_id" uuid;--> statement-breakpoint
UPDATE "customers" SET "contact_type_id" = (SELECT "id" FROM "contact_types" WHERE "system_key" = 'customer');
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "contact_type_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_types_name_unique" ON "contact_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "contact_types_system_key_unique" ON "contact_types" USING btree ("system_key");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_contact_type_id_contact_types_id_fk" FOREIGN KEY ("contact_type_id") REFERENCES "public"."contact_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_contact_type_idx" ON "customers" USING btree ("contact_type_id");