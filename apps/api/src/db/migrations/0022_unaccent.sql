-- Search that ignores diacritics: „Toth“ finds „Tóth“, „kosice“ finds „Košice“. A trusted
-- extension: the database owner may create it, no superuser needed.
CREATE EXTENSION IF NOT EXISTS unaccent;
