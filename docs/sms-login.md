# SMS: phone sign-in and "send me the list"

Two features share one 019 account and one switch (`NEXT_PUBLIC_SMS_LOGIN`):
signing in with a phone number and a code, and texting the shopping list to
yourself. The first section is the sign-in; the list is further down.

## Phone sign-in with an SMS code

The login screen can offer "enter your mobile number, get a code". Supabase
makes and checks the six-digit code; the text itself goes out through the 019
SMS gateway, by way of Supabase's **Send SMS** auth hook.

```
browser ── signInWithOtp({phone}) ──▶ Supabase ── hook (HTTPS) ──▶ /api/auth/send-sms ──▶ 019
browser ── verifyOtp({phone, token}) ─▶ Supabase           (checks the code, starts the session)
```

- `src/app/login/PhoneLogin.tsx`: the screen (number, then code, resend after 30 s).
- `src/app/api/auth/send-sms/route.ts`: the hook. It checks the Standard Webhooks
  signature (`src/server/webhook.ts`) and sends the text with `src/server/sms019.ts`.
- `src/lib/phone.ts`: Israeli mobile numbers only (`05X-XXX-XXXX`, stored as `+972…`).
- `src/app/account`: someone who signed in by email can add a phone number here.

Email sign-in keeps working next to it (see `email-login.md`). The phone option
only appears when `NEXT_PUBLIC_SMS_LOGIN=true`, so nothing half-working is ever
shown.

### Setup (once per environment)

Do the dev project first (Vercel **Preview** + `scan-home-dev`), then prod.

1. **019 account.** In the 019 console create an API token and make sure the
   account's IP restriction is **off**: Vercel's outgoing addresses change, so a
   fixed allow-list would block us. The sender name (`HomeOne`, at most 11
   characters) may need 019's approval before messages go out; 019 answers with
   status 515 until it is approved.
2. **Vercel environment variables** (mark the token and the secret *Sensitive*):

   | Name | Value |
   | --- | --- |
   | `SMS019_USERNAME` | the 019 user name |
   | `SMS019_TOKEN` | the 019 API token |
   | `SMS019_SOURCE` | sender name, e.g. `HomeOne` |
   | `SEND_SMS_HOOK_SECRET` | from step 4 |
   | `NEXT_PUBLIC_SMS_LOGIN` | `true` (last) |

3. **Supabase → Authentication → Sign In / Providers → Phone**: enable it. Leave
   the SMS provider as it is (Twilio is a placeholder: the hook replaces it).
   "Enable phone confirmations" on.
4. **Supabase → Authentication → Hooks → Send SMS**: choose *HTTPS*, URL
   `https://<site>/api/auth/send-sms`, and *Generate secret*. Copy the secret
   (`v1,whsec_…`) into `SEND_SMS_HOOK_SECRET` in Vercel.
5. Redeploy (the `NEXT_PUBLIC_` value is baked in at build time) and try it.

Never paste the token or the secret into a chat or commit them: they go straight
into Vercel.

### What each failure means

The hook answers Supabase with an HTTP status; Supabase turns it into the error
the person sees (the screen says "couldn't send, try again").

| Hook answer | Cause |
| --- | --- |
| 503 | `SEND_SMS_HOOK_SECRET` or one of the `SMS019_*` variables is missing |
| 401 | the secret in Vercel is not the one Supabase signs with (regenerated?) |
| 400 | not an Israeli mobile number, or an unexpected payload |
| 502 | 019 refused or was unreachable; the Vercel log line `send-sms: …` names its status (never the number or the code) |

Supabase's own limits apply on top: a code can be asked for about once a minute
per number, and the screen waits 30 s before offering "send again".

### Cost

Every sign-in or resend is one SMS from the 019 balance. The email way stays
free; the phone screen offers it as "sign in with email instead".

## "Send me the list" by SMS

On the list screen, under the open items, **שלחו לי את הרשימה ב־SMS** texts the
open list to the signed-in person's own phone, to take to the shop.

- `src/app/SendListButton.tsx`: the button and its messages.
- `src/app/api/list/sms/route.ts`: reads the list as the signed-in person (so
  row level security keeps it to their household) and sends it with `sendSms`.
- `src/server/listMessage.ts`: the text. A Hebrew SMS is 70 characters a piece
  and every piece is billed, so it stops at about 330 characters and ends with
  "ועוד N באפליקציה".

**Who it can text.** Only the number on the person's own account, and only once
they confirmed it with a code (`phone_confirmed_at`). The request carries no
number, so the route cannot be used to text anyone else. Someone who signed in
with email adds a number on the account page (`/account`) first; until then the
button explains that.

**The allowance.** Each person can send 5 an hour and 20 a day
(`reserve_sms_send()` in `supabase/migrations/20261118000001_sms_sends.sql`, a
function the web server calls with the person's own session; nobody can read or
write the `sms_sends` table). A send that 019 then refuses still counts: it
only matters when 019 is down, and the allowance is generous for a shopping list.

**Setup.** Nothing new beyond the sign-in setup above, except that the migration
must be applied to each Supabase project (it is not run automatically, see
`supabase.md`): scan-home-dev now, scan-home-prod when releasing to `main`.
The button appears with `NEXT_PUBLIC_SMS_LOGIN=true`.

| Answer | Meaning |
| --- | --- |
| 200 | sent; the screen says to which number |
| 409 `no_phone` | no confirmed Israeli mobile on the account |
| 429 `limited` | over the allowance |
| 400 `empty` | nothing on the list |
| 503 `not_set_up` | the 019 variables are missing |
| 502 `send_failed` | 019 refused (see the `list-sms:` line in the Vercel log) |
| 500 `read_failed` | the list or `reserve_sms_send()` could not be read (migration not applied?) |
