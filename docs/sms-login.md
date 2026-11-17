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

- `src/app/login/PhoneLogin.tsx`: the screen (number, then code, resend after 60 s).
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
   | `OTP_SMS_DOMAIN` | optional: the host people sign in on, e.g. `app.example.com`. Makes the text end with `@host #code` so Android fills the code in and iPhone suggests it. One extra SMS segment per text |
   | `NEXT_PUBLIC_SMS_LOGIN` | `true` (last) |

3. **Supabase → Authentication → Sign In / Providers → Phone**: enable it. Leave
   the SMS provider as it is (Twilio is a placeholder: the hook replaces it).
   "Enable phone confirmations" on. Keep the code **6 digits** (the hook and the
   login screen both expect six) and set the **SMS OTP expiry** to 300 seconds:
   long enough for a late text or a trip to the messages app, short enough to
   limit guessing. Leave "test phone numbers" empty outside local testing.
   **Authentication → Rate Limits**: keep the SMS-per-hour cap low while the user
   base is small (it also caps what an abuser can spend), and leave the
   verification limit per IP at its default.
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
| 503 | `SEND_SMS_HOOK_SECRET` or one of the `SMS019_*` variables is missing, **or** 019 refused for a reason only its account owner can fix (credit, credentials, sender name, IP rule). The log line then says `[needs the 019 account owner]` |
| 401 | the secret in Vercel is not the one Supabase signs with (regenerated?) |
| 400 | not an Israeli mobile number, or an unexpected payload |
| 502 | 019 was busy or did not answer in time; the Vercel log line `send-sms: …` names its status (never the number or the code) |

Supabase's own limits apply on top: a code can be asked for once a minute per
number, and the screen waits 60 s before offering "send again".

Supabase gives a hook 5 seconds in all, retries included, so `sms019.ts` stops
at 4.2 s (one retry when 019 answers 429): a text is sent while the person is
still waiting, or not at all. Hook errors of 400 and above reach the app as a
generic failure, so the screen does not rely on the hook's wording.

### Edge cases the screens handle

| Case | What happens |
| --- | --- |
| A number typed with spaces, dashes, `+972`, `00972`, `(0)`, Arabic or Persian digits, or invisible direction marks | read as the same number (`src/lib/phone.ts`) |
| Landline, VoIP (07X), foreign number | refused on the screen and again in the hook (Israeli mobiles only: also the main defence against SMS pumping) |
| Enter pressed twice, double tap | one request (`busy` guard, and one verify at a time) |
| Code requested again within a minute | goes to the code box: the earlier code still works. The countdown uses the wait Supabase reports |
| Code pasted as `123 456`, with Arabic digits, or autofilled | read as the six digits (no `maxLength` on the box) |
| Wrong or expired code | box cleared and refocused; Supabase reports both as `otp_expired` (403), so the message covers both. After 5 wrong codes the box waits for a new code (UX only: the real limits are Supabase's verify limits and the short expiry) |
| Connection drops while checking | the typed code is kept and "כניסה" retries it |
| Person leaves to read the text and the browser drops the page | the code box is restored from `localStorage` for 10 minutes, with the wait that is left |
| No text after a minute (a phone that cannot get SMS, no signal, a late gateway) | "sign in with email instead" appears |
| 019 out of credit, bad token, unapproved sender | the person sees "could not send" with the email option; the log line is flagged for the account owner |
| Adding a number that belongs to another account | "already belongs to another account" |
| Adding the number the account already has | nothing is sent |

### Not handled in code (decisions and settings)

- **CAPTCHA.** The strongest defence against someone using the form to text a
  stranger or burn the balance is Supabase's CAPTCHA (Cloudflare Turnstile). It
  needs the widget on both login forms, so it is a separate change.
- **One person, two accounts.** Signing in by phone with a number that was never
  added to an email account starts a new, empty account. The login screen says
  how to avoid it; there is no account merge.
- **A number that changes hands.** A carrier can give an old number to someone
  else; SMS sign-in cannot tell. The number can be replaced in the account screen.
- **SIM swap and SMS interception.** Inherent to SMS codes (NIST classes SMS as a
  restricted authenticator). Acceptable for a shopping list; revisit if the app
  ever holds anything more sensitive.
- **019 sending hours.** 019's error 5 is "no permission to send SMS at this
  time". Confirm with 019 that the account sends service messages around the
  clock (nights, Shabbat).

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
