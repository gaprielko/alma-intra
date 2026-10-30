-- D-48: an e-mail is one person. A live contact takes over the activities, e-mails and replies of the
-- removed contacts with its e-mail. Those without a live contact are merged when the e-mail is added.
CREATE TEMP TABLE merged_contacts AS
  SELECT removed.id AS removed_id, live.id AS live_id
  FROM contacts removed
  JOIN contacts live ON lower(live.email) = lower(removed.email) AND live.deleted_at IS NULL
  WHERE removed.deleted_at IS NOT NULL;--> statement-breakpoint

-- Where the person already took part, one row is enough.
DELETE FROM activity_participants p
USING merged_contacts m
WHERE p.contact_id = m.removed_id
  AND EXISTS (SELECT 1 FROM activity_participants q
    WHERE q.activity_id = p.activity_id AND q.contact_id = m.live_id);--> statement-breakpoint
DELETE FROM activity_participants p
USING merged_contacts m
WHERE p.contact_id = m.removed_id
  AND p.id NOT IN (SELECT DISTINCT ON (x.activity_id, y.live_id) x.id
    FROM activity_participants x JOIN merged_contacts y ON y.removed_id = x.contact_id
    ORDER BY x.activity_id, y.live_id, x.id);--> statement-breakpoint
UPDATE activity_participants p SET contact_id = m.live_id
FROM merged_contacts m WHERE p.contact_id = m.removed_id;--> statement-breakpoint

-- A campaign has one message for a person at an organization: another one keeps its removed contact.
UPDATE campaign_messages c SET contact_id = m.live_id
FROM merged_contacts m
WHERE c.contact_id = m.removed_id
  AND c.id IN (SELECT DISTINCT ON (x.campaign_id, x.organization_id, y.live_id) x.id
    FROM campaign_messages x JOIN merged_contacts y ON y.removed_id = x.contact_id
    WHERE NOT EXISTS (SELECT 1 FROM campaign_messages q
      WHERE q.campaign_id = x.campaign_id AND q.organization_id = x.organization_id
        AND q.contact_id = y.live_id)
    ORDER BY x.campaign_id, x.organization_id, y.live_id, x.id);--> statement-breakpoint

UPDATE inbound_messages i SET contact_id = m.live_id
FROM merged_contacts m WHERE i.contact_id = m.removed_id;--> statement-breakpoint

DROP TABLE merged_contacts;
