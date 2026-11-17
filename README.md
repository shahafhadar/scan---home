# scan-home

Next.js MVP, deployed on Vercel.

## Local development

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm test
npm run build
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every pull request and every push to `main`:
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
