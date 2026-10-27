# Runbook: production

How Alma Intra is put into production for the first time, deployed, checked, backed up and rolled
back. It follows Alma ADOS's runbook (`alma-ados/docs/runbook.md`): same hosting (Hetzner + Coolify),
same image shape, same backup job. Keep this file in step with what is actually configured.

Everything here is done by a person with access to Hetzner, Coolify, Resend and the DNS of
`alma-care.eu` (at Websupport). No secret is ever written into the repository or into a chat.

## 0. What you need before you start

| What                        | Why                                                                     |
| --------------------------- | ----------------------------------------------------------------------- |
| Hetzner Cloud account       | the server, the files bucket, the backup bucket                         |
| DNS of `alma-care.eu`       | `intra.alma-care.eu` (the app, D-18) and `mail.alma-care.eu` (sending, D-17a) |
| Resend account              | system e-mails (invitations, password resets); later campaigns         |
| GitHub `gaprielko/alma-intra` | Coolify builds the image from it                                      |
| A password manager          | every secret generated below goes there first                          |
| `openssl` on your machine   | generating secrets                                                      |

The code that is deployed must be on GitHub: Coolify builds from a branch (`main` once
`feature/INTRA-1` is merged; until then the feature branch itself).

## 1. Server and Coolify

Intra gets its **own server**, separate from Alma ADOS: ADOS holds health data and its staging
server (4 GB) already builds one image at a time. Intra holds no health data, but customer
contacts and company files; keeping them apart keeps each one's access, backups and incidents
apart.

1. Hetzner Cloud console → project `alma-intra` → Add server: location Nuremberg (`nbg1`),
   Ubuntu 24.04, type **CPX22** (2 vCPU, 4 GB) or bigger, your SSH key, no password.
2. Firewall `alma-intra`: inbound TCP 22, 80, 443 and ICMP only. Attach it to the server.
3. On the server (`ssh root@<ip>`):
   - swap, as on ADOS (builds run out of memory without it):
     ```bash
     fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
     echo '/swapfile none swap sw 0 0' >> /etc/fstab
     sysctl vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf
     ```
   - password login off: `/etc/ssh/sshd_config.d/99-alma.conf` with `PasswordAuthentication no`,
     then `systemctl reload ssh`.
   - Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`.
4. Open the Coolify panel (`http://<ip>:8000` the first time), create the admin account, then give
   the panel a https domain (e.g. `coolify.alma-care.eu`, with its DNS A record) and close
   port 8000 again (it is not in the firewall above).
5. Coolify → Servers → localhost → Advanced → **Concurrent builds: 1**.

## 2. DNS

At Websupport → `alma-care.eu` → DNS (a DNS record, not „Presmerovanie“: a redirect sends the
browser to the bare IP, without https, and Coolify cannot tell which app is meant):

| Type | Name                | Value           |
| ---- | ------------------- | --------------- |
| A    | `intra` (`intra.alma-care.eu`) | the server's IP |

The records of the sending domain come in step 5 (Resend shows them).

## 3. PostgreSQL

1. Coolify → project `alma-intra` → New resource → Database → **PostgreSQL 16**. Name
   `intra-db`. Do **not** make it public. Start it.
2. Roles. The app never connects as the owner of the tables: the audit trail is append-only only
   because `intra_app` cannot delete from it (migration `0001`). Generate two passwords with
   `openssl rand -hex 24` (hex: no escaping in a URL), store both, then on the server:

   ```bash
   docker exec -i <postgres container> psql -U postgres
   ```

   ```sql
   CREATE DATABASE alma_intra;
   CREATE ROLE intra_admin LOGIN PASSWORD '<admin password>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   ALTER DATABASE alma_intra OWNER TO intra_admin;
   CREATE ROLE intra_app LOGIN PASSWORD '<app password>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   \c alma_intra
   ALTER SCHEMA public OWNER TO intra_admin;
   GRANT CONNECT ON DATABASE alma_intra TO intra_app;
   GRANT USAGE ON SCHEMA public TO intra_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE intra_admin IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO intra_app;
   ALTER DEFAULT PRIVILEGES FOR ROLE intra_admin IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO intra_app;
   ```

   This mirrors `apps/api/db/init/01-roles.sql` (local Docker). It must exist before the first
   deploy: migration `0001` names `intra_app`.

3. `<postgres container>` and its name on Coolify's network (the host in the URLs below) are on
   the database's page in Coolify.

## 4. Files bucket (Hetzner Object Storage)

1. Hetzner console → project `alma-intra` → Object Storage → Create bucket `alma-intra-files`,
   location `nbg1`, visibility **private**.
2. Security → S3 credentials → Generate, description `alma-intra-app`. Store the access key and
   the secret.
3. CORS: after the first deploy (step 9).
4. Versioning (recommended, as on ADOS): a deleted or overwritten object stays recoverable for 30
   days. With the app's credentials:

   ```bash
   docker run --rm -it --entrypoint sh quay.io/minio/mc:RELEASE.2025-04-16T18-13-26Z -c '
     mc alias set files https://nbg1.your-objectstorage.com &&
     mc version enable files/alma-intra-files &&
     mc ilm rule add --noncurrent-expire-days 30 files/alma-intra-files &&
     mc version info files/alma-intra-files && mc ilm rule ls files/alma-intra-files'
   ```

   Unverified on Hetzner (checked against MinIO only), and quay.io refused anonymous pulls of the
   MinIO images on 27 Oct 2026: if the image does not pull, use any S3 client (`aws s3api
   put-bucket-versioning …`) with the same endpoint and keys. If Hetzner refuses versioning,
   note it here.

## 5. E-mail: Resend and the sending domain

System e-mails (the invitation of the first user, every later invitation, password resets) go
through Resend. Without a verified domain Resend delivers only to the address that owns the Resend
account, so the first user's invitation would not arrive.

1. Resend → Domains → Add domain → **`mail.alma-care.eu`** (the sending subdomain, D-17a), region
   **Ireland (`eu-west-1`)**. The region cannot be changed later.
2. Resend shows the DNS records. Add them in Websupport's DNS exactly as shown: a DKIM TXT
   (`resend._domainkey.mail.alma-care.eu`), an MX and an SPF TXT on the bounce subdomain
   (`send.mail.alma-care.eu`). A name carries one SPF record only: merge, never add a second.
   DMARC: a TXT `_dmarc` on `alma-care.eu` (it covers the subdomains) with
   `v=DMARC1; p=none; rua=mailto:info@alma-care.eu`, unless one exists already.
3. Wait for **Verified** in Resend.
4. Resend → API keys → Create, permission **Sending access**, domain `mail.alma-care.eu`, name
   `alma-intra-production`. Store it.
5. Replies to system mails go to `MAIL_REPLY_TO` (default `info@alma-care.eu`, D-17b). That
   mailbox must exist (a mailbox at Websupport, or a forward), or every answer bounces.

## 6. Secrets

Generate and store in the password manager:

| Secret                | Command                   | Note                                                                 |
| --------------------- | ------------------------- | -------------------------------------------------------------------- |
| `AUTH_ACCESS_SECRET`  | `openssl rand -base64 48` | signs the access tokens; changing it signs everybody out             |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` | encrypts the second-factor secrets. **Losing it locks everybody out of the second step**: each user then needs a reset of the second factor by somebody who can still sign in. Keep two copies. |

## 7. The application in Coolify

Coolify → project `alma-intra` → New resource → Application → GitHub (connect the GitHub App the
first time, with access to `gaprielko/alma-intra` only):

- Branch: `main` (or `feature/INTRA-1` until it is merged).
- Build pack **Dockerfile**, base directory `/`, Dockerfile location `/apps/api/Dockerfile`.
- Port **3100**. Domain `https://intra.alma-care.eu` (Coolify gets the certificate from Let's
  Encrypt once the DNS record of step 2 resolves).
- No fixed host port mapping and no custom container name (both block rolling updates).
- **Healthcheck:** on, path `/health`, port 3100, `GET`, expect `200`, start period **40 s** (the
  container runs the migrations before the API listens).

Environment variables (all **runtime**, none a build variable; the web needs no build variables):

| Variable               | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`             | `production` (the image sets it; secure cookies, strict checks)          |
| `DATABASE_URL`         | `postgres://intra_app:<app password>@<postgres host>:5432/alma_intra`    |
| `DATABASE_ADMIN_URL`   | `postgres://intra_admin:<admin password>@<postgres host>:5432/alma_intra` |
| `AUTH_ACCESS_SECRET`   | from step 6                                                              |
| `DATA_ENCRYPTION_KEY`  | from step 6                                                              |
| `WEB_URL`              | `https://intra.alma-care.eu` (links in e-mails, the bucket's CORS)       |
| `RESEND_API_KEY`       | from step 5                                                              |
| `MAIL_FROM`            | `Alma Intra <info@mail.alma-care.eu>`                                    |
| `MAIL_REPLY_TO`        | unset (default `info@alma-care.eu`)                                      |
| `CAMPAIGN_FROM_ADDRESS` | `info@mail.alma-care.eu` (the default; e-mails to customers, E5) |
| `S3_ENDPOINT`          | `https://nbg1.your-objectstorage.com`                                    |
| `S3_REGION`            | `nbg1`                                                                   |
| `S3_BUCKET`            | `alma-intra-files`                                                       |
| `S3_ACCESS_KEY_ID`     | from step 4                                                              |
| `S3_SECRET_ACCESS_KEY` | from step 4                                                              |
| `LOG_LEVEL`            | `info`                                                                   |

What the API refuses to start without in production (`apps/api/src/config/env.ts`, `mailer.ts`,
`storage.ts`): a real `AUTH_ACCESS_SECRET` (not the placeholder), `RESEND_API_KEY`, all five
`S3_*` with an `https` endpoint and a real secret. The container then exits and its log says
which variable.

`DATABASE_ADMIN_URL` is used only by the migrations at start; the server process is started
without it (`CMD` in the Dockerfile). Do not set `PASSWORD_BREACH_CHECK`: production checks new
passwords against Have I Been Pwned (5 hex characters of a SHA-1 leave the server, fail-open).

## 8. First deploy

1. Deploy. The log shows the build, then `migrated`, then the API starting.
2. `curl https://intra.alma-care.eu/health` → `{"status":"ok","commit":"…"}`.
3. Open `https://intra.alma-care.eu`: the sign-in page.

If the container exits: Coolify → Logs. A missing or weak variable is named; `password
authentication failed` is a URL; `role "intra_app" does not exist` means step 3 was skipped.

## 9. Bucket CORS (once)

The browser uploads and downloads straight from the bucket, so it must allow `WEB_URL`. In
Coolify → the application → Terminal (or `docker exec` on the server):

```bash
node dist/storage/bucket-cors.cli.js
```

It prints `CORS set on alma-intra-files for https://intra.alma-care.eu`. Run it again whenever
`WEB_URL` changes.

## 10. The first user

The production database starts empty. In the application's Terminal:

```bash
node dist/db/create-first-user.cli.js --email <e-mail> --name "<Meno Priezvisko>"
```

It prints `first user bootstrap: user <id> invited` and queues an invitation; the running API's
outbox worker sends it within seconds. The link is valid **72 hours**. The person sets a password
and a second factor (an authenticator app); the recovery codes shown then go into a password
manager. From then on that user invites everybody else in Nastavenia › Používatelia.

The command works only while no other user exists. Run again for the same e-mail before the
invitation is accepted, it queues the mail again (`invited_again`). If the mail does not arrive:

```bash
docker exec -it <postgres container> psql -U intra_admin alma_intra
```

```sql
select id, kind, created_at, attempts, sent_at, failed_at, recipient_masked, last_error
from mail_outbox order by created_at desc limit 10;
```

`last_error` like `provider:validation_error` is almost always the sender: `MAIL_FROM` not on the
verified domain. Fix the variable, redeploy, run the command again.

## 11. Checking that it works

- [ ] Sign in with the password and the second factor; sign out; sign in again.
- [ ] Nastavenia › Používatelia: invite a second person; the mail arrives.
- [ ] Zákazníci: create a customer, add a contact, export CSV.
- [ ] Súbory: upload a PDF into „Firemné dokumenty“ (the progress panel reaches „Hotovo“), open it
      (Náhľad), download it (the saved file has its real name), upload a new version, move it to
      the trash and restore it.
- [ ] The customer's detail shows the customer's files card; an upload there lands in its folder.
- [ ] In the browser's console no CSP error (a CSP error on upload means `S3_ENDPOINT` differs
      from the bucket's real origin).

## 12. Backups

Not in place until done, and **before real customer data goes in**. The database backup reuses
ADOS's job (`alma-ados/ops/backup`: `pg_dump` encrypted with `age`, uploaded to its own bucket,
alerting through healthchecks.io); it takes the database name from `PGDATABASE`, nothing in it is
ADOS-specific. Follow „Backups and restore“ in `alma-ados/docs/runbook.md`, with:

- Hetzner project and bucket `alma-intra-backups` (a project of its own: the app's S3 keys must
  not reach the backups), its own S3 credentials, the 30-day lifecycle rule.
- The age key pair: ADOS's may be reused (same custody) or a new one; note which here.
- Coolify app `alma-intra-backup` from the repository `alma-ados`, base directory `/ops/backup`,
  watch paths `ops/backup/**`, with `PGHOST` = the Intra Postgres host, `PGUSER=intra_admin`,
  `PGDATABASE=alma_intra`, `BACKUP_S3_BUCKET=alma-intra-backups` and the rest as in ADOS's table.
  Scheduled task `nightly-backup`, `/opt/alma-backup/backup.sh`, cron `30 1 * * *`.
- healthchecks.io check `alma-intra-backup`; first run by hand; a restore drill within the first
  month, then monthly.

The files are not in the database dump: the bucket's versioning (step 4) is their safety net.

## Deploy (every release)

- Coolify builds on a push to the configured branch (or Deploy by hand). The new container runs
  the migrations, then starts; with the health check on, the proxy switches only when it is
  healthy, and a failing one leaves the old container serving.
- Migrations run while the old container still serves, so each must work with the code currently
  deployed: add first, drop or rename only in a later release.
- The production dependencies are installed from `pnpm-lock.yaml` only (`--frozen-lockfile`).
- Check `/health` after each deploy; its `commit` is the deployed one once Coolify sets
  `SOURCE_COMMIT`.

## Rollback

- Bad code, no migration involved: Coolify → Deployments → redeploy the previous one.
- Bad migration: migrations go forward only. Write a new one that fixes it; restore from backup
  only when data was lost.

## Access

- SSH by key only; Postgres never on a public port; Coolify's panel only over https.
- Uptime: a monitor (e.g. UptimeRobot) on `GET https://intra.alma-care.eu/health` every 5 minutes.

## Not covered yet

- Staging: none for Intra. A second Coolify application with its own database, bucket and Resend
  subdomain would be one.
- Error reporting (Sentry): Intra has none yet; the logs (pino JSON on stdout, in Coolify) are all.
- E-mail campaigns (E5) and inbound replies (E6) will add their own Resend setup (webhooks,
  inbound domain) here.
