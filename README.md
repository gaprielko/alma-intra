# Alma Intra

The internal system of Alma: customers and contacts, personalised e-mails from templates, files,
activities and replies. Web only, in Slovak.

- What it does: [docs/functional-spec.md](docs/functional-spec.md)
- How the screens look: [docs/design/](docs/design/)
- How to work in this repo: [CLAUDE.md](CLAUDE.md)

## Quick start

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env    # set DATA_ENCRYPTION_KEY: openssl rand -base64 32
pnpm --filter @intra/shared build
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Web: http://localhost:5180 · API: http://localhost:3100

## Deployment

One image (`apps/api/Dockerfile`): the API serves the built web. On start it runs the migrations
as `intra_admin`, then the server as `intra_app`. Required in production: `DATABASE_URL`,
`DATABASE_ADMIN_URL`, `AUTH_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY`, `RESEND_API_KEY`, `MAIL_FROM`,
`WEB_URL` (see `.env.example`). After the first deploy, create the first user:

```bash
node dist/db/create-first-user.cli.js --email <e-mail> --name "<name>"
```
