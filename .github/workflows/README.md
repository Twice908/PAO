# Deploy workflow

`deploy.yml` is manual-only (`workflow_dispatch`) and refuses to run on any
branch but `main` — the `guard-main` job fails the whole run otherwise.

It does **not** push code to Vercel or Railway itself. Both platforms'
native GitHub integrations already redeploy on push to `main`; this
workflow's job is to build/lint/test each service as a gate, then confirm
via each platform's API that the deploy for the current commit actually
succeeded — so a manual "deploy everything" run fails loudly instead of
looking green while a service is broken.

## Jobs

| Job | Service | What it does |
|---|---|---|
| `web` | apps/web → Vercel | builds, then polls the Vercel API until the deployment for this commit is `READY` |
| `api` | apps/api → Railway | lint + test + build, then polls Railway until the service's latest deployment is `SUCCESS` |
| `worker` | apps/worker → Railway | same as `api` |
| `datastores` | Postgres + Redis (Railway) | provisioning/health check only — these are provisioned once in Railway, not built or redeployed by this repo, so this job just confirms both are up |
| `summary` | — | fails the run if any of the above didn't succeed |

## Required GitHub secrets

Set these under **Settings → Secrets and variables → Actions** before the
first dispatch.

### Vercel

| Secret | Where to get it |
|---|---|
| `VERCEL_TOKEN` | Vercel dashboard → Account Settings → Tokens |
| `VERCEL_PROJECT_ID` | Project → Settings → General ("Project ID") |
| `VERCEL_ORG_ID` | Account/Team Settings → General ("Team ID", or your personal account ID) |

### Railway

| Secret | Where to get it |
|---|---|
| `RAILWAY_TOKEN` | Railway dashboard → Account Settings → Tokens (project-scoped token recommended) |
| `RAILWAY_PROJECT_ID` | Railway project → Settings → General |
| `RAILWAY_API_SERVICE_ID` | the `apps/api` service → Settings → the service ID in its URL |
| `RAILWAY_WORKER_SERVICE_ID` | the `apps/worker` service, same way |
| `RAILWAY_POSTGRES_SERVICE_ID` | the Postgres plugin/service, same way |
| `RAILWAY_REDIS_SERVICE_ID` | the Redis plugin/service, same way |

## Prerequisites this workflow assumes

- A Railway project already exists with four services: `api`, `worker`,
  a Postgres instance, and a Redis instance — each connected to this
  GitHub repo (`api`/`worker`) or provisioned directly (Postgres/Redis).
- A Vercel project already exists for `apps/web`, connected to this repo.
- Both platforms' GitHub integrations are configured to deploy on push to
  `main`. This workflow verifies those deploys; it does not create them.

## Running it

Actions tab → **Deploy** → **Run workflow** → branch must be `main`.
