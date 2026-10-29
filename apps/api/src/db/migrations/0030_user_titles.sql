ALTER TABLE "users" ADD COLUMN "title_before" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title_after" text;--> statement-breakpoint
-- Titles typed into the name move to their own columns: the leading abbreviations („Ing. arch.“)
-- before it, whatever follows the first comma („PhD.“) after it.
UPDATE "users" SET
  "title_before" = nullif(trim(substring("name" from '^((?:[[:alpha:]]{1,8}\.\s*)+)')), ''),
  "title_after" = nullif(trim(substring("name" from ',\s*(.+)$')), ''),
  "name" = trim(regexp_replace(regexp_replace("name", '^([[:alpha:]]{1,8}\.\s*)+', ''), '\s*,.*$', ''))
WHERE ("name" ~ '^[[:alpha:]]{1,8}\.\s' OR "name" LIKE '%,%')
  AND char_length(trim(regexp_replace(regexp_replace("name", '^([[:alpha:]]{1,8}\.\s*)+', ''), '\s*,.*$', ''))) >= 2;
