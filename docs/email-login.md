# Email sign-in

Sign-in is passwordless: the person types their email and gets one email.

The login screen asks Supabase for the email with the **implicit flow**
(`supabaseMailer()` in `src/lib/supabase/client.ts`). The link in the email then
carries the session in the URL fragment: `/auth/callback#access_token=…`. The
server never sees a fragment, so `/auth/callback` passes the browser on to
`/auth/confirm`, which reads it, stores the session and clears the address bar.
Because the link needs nothing from the browser that asked for it, it works in
whatever browser opens it, including a mail app's built-in browser on a phone.

The earlier PKCE flow did not: it only works in the browser that asked for the
link, so on a phone the person got "invalid or expired". `/auth/callback` still
accepts a PKCE `?code=` for that reason, and a `?token_hash=…&type=email` link.

**The default Supabase email works as is.** Nothing below is required.

## Optional: a code in the email

The login screen has a "got a code?" box that signs in in the same tab with
`verifyOtp`. It needs the Magic Link template to include `{{ .Token }}`. Set it
per project (scan-home-dev and scan-home-prod), in Authentication → Emails →
Magic Link:

Subject: `קוד הכניסה ל־scan home: {{ .Token }}`

```html
<div dir="rtl" style="font-family:system-ui,sans-serif;max-width:420px;margin:auto">
  <h2 style="margin:0 0 12px">scan home</h2>
  <p>קוד הכניסה שלך:</p>
  <p style="font-size:32px;letter-spacing:8px;font-family:monospace;margin:8px 0 20px" dir="ltr">{{ .Token }}</p>
  <p>או לחיצה על הכפתור:</p>
  <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email"
        style="display:inline-block;background:#166534;color:#fff;padding:12px 20px;border-radius:12px;text-decoration:none">כניסה</a></p>
  <p style="color:#6b6f68;font-size:13px">הקוד והקישור בתוקף לשעה ולשימוש אחד. אם לא ביקשת, אפשר להתעלם.</p>
</div>
```

The button uses `?token_hash=…`, which `/auth/callback` verifies on the server.
`{{ .RedirectTo }}` is the `emailRedirectTo` the app sends
(`<origin>/auth/callback`), so one template serves develop and production. That
origin must be in Authentication → URL Configuration → Redirect URLs.

### Authentication → Emails → SMTP Settings (Resend)

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key (sending access) |
| Sender email | `onboarding@resend.dev` until a domain is verified in Resend |
| Sender name | `scan home` |

Without a verified domain, Resend only delivers to the email address that
owns the Resend account. Fine for one tester; anyone else needs a verified
domain. After SMTP is set, raise Authentication → Rate Limits → emails per
hour (the built-in sender is capped at 2 an hour).
