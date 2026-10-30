-- Gives a live contact the history of the removed contacts with the same e-mail: the activities they
-- took part in, the e-mails sent to them and the replies received from them.
--
-- Run as intra_admin. Without `apply` it only reports and rolls back:
--   \set email 'someone@example.com'
--   \i move-deleted-contact-history.sql
-- After reading the report, to save it:
--   \set apply 1
--   \i move-deleted-contact-history.sql
--
-- Not moved: the removed contact's own history in audit_events (append-only), its note and
-- salutation, and its organizations, which were taken off when it was removed.

\set ON_ERROR_STOP on

begin;

create temp table moved_live on commit drop as
  select id from contacts where lower(email) = lower(:'email') and deleted_at is null;
create temp table moved_old on commit drop as
  select id from contacts where lower(email) = lower(:'email') and deleted_at is not null;

-- Exactly one live contact is the target; anything else stops here.
select 1 / (count(*) = 1)::int as exactly_one_live_contact from moved_live;
select count(*) as removed_contacts from moved_old;

-- Where both were at the same activity, the live contact's row is enough.
with gone as (
  delete from activity_participants p
  using moved_old o
  where p.contact_id = o.id
    and exists (select 1 from activity_participants q join moved_live l on l.id = q.contact_id
      where q.activity_id = p.activity_id)
  returning 1)
select count(*) as duplicate_participants_removed from gone;

with moved as (
  update activity_participants p set contact_id = (select id from moved_live)
  from (select distinct on (activity_id) p2.id
        from activity_participants p2 join moved_old o on o.id = p2.contact_id
        order by activity_id, p2.id) one
  where p.id = one.id
  returning 1)
select count(*) as activities_moved from moved;

-- Two removed contacts at one activity: the row left over adds nothing.
with gone as (
  delete from activity_participants p using moved_old o where p.contact_id = o.id returning 1)
select count(*) as leftover_participants_removed from gone;

-- A campaign's message to the live contact stays; the older one keeps its removed contact.
with moved as (
  update campaign_messages m set contact_id = (select id from moved_live)
  from moved_old o
  where m.contact_id = o.id
    and not exists (select 1 from campaign_messages q join moved_live l on l.id = q.contact_id
      where q.campaign_id = m.campaign_id and q.organization_id = m.organization_id)
  returning 1)
select count(*) as emails_moved from moved;

select count(*) as emails_left_behind
from campaign_messages m join moved_old o on o.id = m.contact_id;

with moved as (
  update inbound_messages m set contact_id = (select id from moved_live)
  from moved_old o where m.contact_id = o.id
  returning 1)
select count(*) as replies_moved from moved;

-- Editing such an activity asks for the contact to be at its organization again: add them there.
select distinct o.name as activities_at_organizations_the_contact_is_not_at
from activity_participants p
join moved_live l on l.id = p.contact_id
join activities a on a.id = p.activity_id and a.deleted_at is null
join organizations o on o.id = a.organization_id
where not exists (
  select 1 from contact_links cl join organizations f on f.id = cl.organization_id
  where cl.contact_id = l.id
    and (f.id = o.id or f.parent_id = o.id or f.id = o.parent_id
      or (f.parent_id is not null and f.parent_id = o.parent_id)))
order by 1;

\if :{?apply}
  commit;
  \echo Saved.
\else
  rollback;
  \echo Nothing saved. To save it: \\set apply 1 and run the script again.
\endif
