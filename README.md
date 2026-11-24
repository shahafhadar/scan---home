# scan-home

A home grocery scanner: a barcode scanner plugged into an ESP32 "brain" sends
each scan to this server, and the shopping list updates live in the web app.

- **Web app and device API**: Next.js on Vercel.
- **Database, sign-in, live updates**: Supabase. Setup: [`docs/supabase.md`](docs/supabase.md).
- **Device protocol**: [`docs/device-protocol.md`](docs/device-protocol.md), compatible with the prototype firmware.

## Local development

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test           # database tests need TEST_DATABASE_URL (see .env.example), otherwise skipped
npm run build
npm run fake-device -- burst   # a pretend scanner against SCAN_HOME_URL
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main` or `develop`:
  install → lint → typecheck → test → build.
- **CD** is handled by Vercel's Git integration (`develop` = Development, `main` = Production):
  - every pull request gets a Preview deployment with its own URL;
  - every merge to `develop` deploys to the Development environment;
  - every merge to `main` deploys to Production.
- `main` and `develop` are protected: changes go through pull requests, and merging requires the `Lint, typecheck, test, build` check to pass.
- Environment variables live in Vercel (Project → Settings → Environment Variables),
  set separately for Preview and Production. See `.env.example` for the list.
- Health check: `GET /api/health` → `{"status":"ok"}`.
- Full guide (Hebrew): [`docs/ci-cd.md`](docs/ci-cd.md). Weekly backups: `.github/workflows/backup.yml`.
