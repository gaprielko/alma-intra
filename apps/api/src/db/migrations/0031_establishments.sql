ALTER TABLE "organizations" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_id_organizations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizations_parent_idx" ON "organizations" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_parent_not_self" CHECK ("organizations"."parent_id" <> "organizations"."id");