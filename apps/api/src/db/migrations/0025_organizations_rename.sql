-- Customers and partners share one table (docs/contacts-redesign.md, stage O1): every
-- customer-named object is renamed; the sales status stays customer_status.
ALTER TYPE "public"."customer_kind" RENAME TO "organization_kind";
--> statement-breakpoint
ALTER TABLE "public"."customer_products" RENAME TO "organization_products";
--> statement-breakpoint
ALTER TABLE "public"."customer_sources" RENAME TO "organization_sources";
--> statement-breakpoint
ALTER INDEX "public"."customer_sources_pkey" RENAME TO "organization_sources_pkey";
--> statement-breakpoint
ALTER TABLE "public"."customer_tags" RENAME TO "organization_tags";
--> statement-breakpoint
ALTER TABLE "public"."customers" RENAME TO "organizations";
--> statement-breakpoint
ALTER INDEX "public"."customers_pkey" RENAME TO "organizations_pkey";
--> statement-breakpoint
ALTER TABLE "public"."contacts" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."contacts_customer_idx" RENAME TO "contacts_organization_idx";
--> statement-breakpoint
ALTER TABLE "public"."contacts" RENAME CONSTRAINT "contacts_customer_id_customers_id_fk" TO "contacts_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organization_products" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."customer_products_product_idx" RENAME TO "organization_products_product_idx";
--> statement-breakpoint
ALTER TABLE "public"."organization_products" RENAME CONSTRAINT "customer_products_customer_id_customers_id_fk" TO "organization_products_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organization_products" RENAME CONSTRAINT "customer_products_product_id_products_id_fk" TO "organization_products_product_id_products_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organization_products" RENAME CONSTRAINT "customer_products_customer_id_product_id_pk" TO "organization_products_organization_id_product_id_pk";
--> statement-breakpoint
ALTER INDEX "public"."customer_sources_name_unique" RENAME TO "organization_sources_name_unique";
--> statement-breakpoint
ALTER TABLE "public"."organization_tags" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."customer_tags_tag_idx" RENAME TO "organization_tags_tag_idx";
--> statement-breakpoint
ALTER TABLE "public"."organization_tags" RENAME CONSTRAINT "customer_tags_customer_id_customers_id_fk" TO "organization_tags_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organization_tags" RENAME CONSTRAINT "customer_tags_tag_id_tags_id_fk" TO "organization_tags_tag_id_tags_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organization_tags" RENAME CONSTRAINT "customer_tags_customer_id_tag_id_pk" TO "organization_tags_organization_id_tag_id_pk";
--> statement-breakpoint
ALTER INDEX "public"."customers_ico_unique" RENAME TO "organizations_ico_unique";
--> statement-breakpoint
ALTER INDEX "public"."customers_status_idx" RENAME TO "organizations_status_idx";
--> statement-breakpoint
ALTER INDEX "public"."customers_contact_type_idx" RENAME TO "organizations_contact_type_idx";
--> statement-breakpoint
ALTER INDEX "public"."customers_owner_idx" RENAME TO "organizations_owner_idx";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_contact_type_id_contact_types_id_fk" TO "organizations_contact_type_id_contact_types_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_owner_user_id_users_id_fk" TO "organizations_owner_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_source_id_customer_sources_id_fk" TO "organizations_source_id_organization_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_created_by_user_id_users_id_fk" TO "organizations_created_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_name_length" TO "organizations_name_length";
--> statement-breakpoint
ALTER TABLE "public"."organizations" RENAME CONSTRAINT "customers_person_named" TO "organizations_person_named";
--> statement-breakpoint
ALTER TABLE "public"."folders" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."folders_customer_idx" RENAME TO "folders_organization_idx";
--> statement-breakpoint
ALTER INDEX "public"."folders_customer_root_unique" RENAME TO "folders_organization_root_unique";
--> statement-breakpoint
ALTER TABLE "public"."folders" RENAME CONSTRAINT "folders_customer_id_customers_id_fk" TO "folders_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."activities" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."activities_customer_idx" RENAME TO "activities_organization_idx";
--> statement-breakpoint
ALTER TABLE "public"."activities" RENAME CONSTRAINT "activities_customer_id_customers_id_fk" TO "activities_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."campaign_messages" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."campaign_messages_customer_idx" RENAME TO "campaign_messages_organization_idx";
--> statement-breakpoint
ALTER TABLE "public"."campaign_messages" RENAME CONSTRAINT "campaign_messages_customer_id_customers_id_fk" TO "campaign_messages_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."inbound_messages" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER INDEX "public"."inbound_messages_customer_idx" RENAME TO "inbound_messages_organization_idx";
--> statement-breakpoint
ALTER TABLE "public"."inbound_messages" RENAME CONSTRAINT "inbound_messages_customer_id_customers_id_fk" TO "inbound_messages_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "public"."notifications" RENAME COLUMN "customer_id" TO "organization_id";
--> statement-breakpoint
ALTER TABLE "public"."notifications" RENAME CONSTRAINT "notifications_customer_id_customers_id_fk" TO "notifications_organization_id_organizations_id_fk";
