# Auth hardening — owner checklist

The code and database changes for the OTP hardening work are done and tested.
These remaining items need a person with dashboard access; a tool cannot do
them. Nothing here is required for the existing email/phone sign-in to keep
working on `develop` — they switch the new protections on and prepare release.

## Needed to open the pull requests
- [ ] **GitHub access** — `gh auth login`, or enable the GitHub connector for
  this session, so the local branches can be pushed and the PRs opened.
  Branches: `feat/otp-abuse-protection`, `feat/account-states`,
  `feat/account-recovery`, `feat/auth-observability` (each stacked on the one
  before, except the first).

## Turn on the abuse protections (dev first, then prod)
- [ ] **OTP_PEPPER** in Vercel (Preview and Production), marked *Sensitive*:
  `openssl rand -hex 32`. Until it is set, the per-number/IP code budget is
  inactive and only Supabase's own limits apply.
- [ ] **Cloudflare Turnstile**: create a Turnstile site, then
  - put its **secret** in Supabase → Authentication → Settings → *Enable CAPTCHA* → Turnstile (dev project, and prod at release);
  - put its **site key** in Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (Preview, and Production at release);
  - redeploy (the key is inlined at build time).
- [ ] **Supabase Auth → Rate limits** (dev and prod): confirm sane per-hour caps
  for SMS and e-mail, and **OTP expiry = 300s** (Phone and Email). No tool can
  read these; set them in the dashboard.

## Account-state model
- [ ] Nothing to configure. To suspend/restore an account, run in the Supabase
  SQL editor (service role): `select public.set_account_status('<user-id>', 'suspended');`
  (or `'active'`, `'disabled'`, `'deleted'`). Every change is recorded in
  `public.security_events`.

## Retention (decide, then schedule)
- [ ] `otp_sends` self-prunes after 2 days. `security_events` grows unbounded —
  decide a retention window and add a scheduled delete (pg_cron or a routine).

## Production release (branch `main`, project `scan-home-prod`) — only with explicit go-ahead
Apply the four new migrations to `scan-home-prod`, in order, then set the
Production env and Auth config. This extends the handoff's release checklist (O3).
- [ ] Apply migrations: `20261122000001_otp_abuse`, `..._000002_account_status`,
  `..._000003_account_deletion`, `..._000004_security_events`
  (plus the pre-existing `20261118000001_sms_sends`, which is not yet in prod).
- [ ] Production env vars: `SMS019_USERNAME`, `SMS019_TOKEN`, `SMS019_SOURCE`,
  `SEND_SMS_HOOK_SECRET` (a fresh secret from the prod Send-SMS hook),
  `OTP_PEPPER`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; set `NEXT_PUBLIC_SMS_LOGIN=true` last.
- [ ] `scan-home-prod` Auth: Site URL `https://scan-home.vercel.app`, redirect
  `https://scan-home.vercel.app/auth/callback`, custom SMTP, Phone provider,
  Send-SMS hook → `https://scan-home.vercel.app/api/auth/send-sms`, CAPTCHA on.
- [ ] 019: confirm service messages go out at night and on Shabbat, and set a
  low-balance alert (handoff O13).

## Verify after switching on
- [ ] `GET /api/health` → ok; sign in by e-mail and by phone on the preview.
- [ ] Over-budget: ask for many codes to one number → later requests refused.
- [ ] Suspend a test account → it lands on `/no-access` and sees no data.
- [ ] Export returns data without the device secret; delete requires a recent
  sign-in and then blocks access.
