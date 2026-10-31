ALTER TABLE "email_look" ADD COLUMN "header_doc" jsonb;--> statement-breakpoint
ALTER TABLE "email_look" ADD COLUMN "sender_name_doc" jsonb;--> statement-breakpoint
ALTER TABLE "product_email_looks" ADD COLUMN "header_doc" jsonb;--> statement-breakpoint
ALTER TABLE "product_email_looks" ADD COLUMN "sender_name_doc" jsonb;--> statement-breakpoint
ALTER TABLE "campaign_messages" ADD COLUMN "from_name" text;--> statement-breakpoint
-- The text in the header keeps what it said, as one line.
UPDATE "email_look" SET "header_doc" = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "header_text"))))) WHERE "header_text" <> '';--> statement-breakpoint
UPDATE "product_email_looks" SET "header_doc" = jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', "header_text"))))) WHERE "header_text" <> '';
