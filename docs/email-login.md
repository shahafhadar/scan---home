# Email sign-in

Sign-in is passwordless. The person types their email, gets one email, and
can use either part of it:

- **The code**: typed into the login screen in the same tab. No redirect, so
  it works whatever browser or mail app the email is opened in.
- **The link**: `/auth/callback?token_hash=…&type=email`, verified on the
  server, so it also works outside the browser that asked for it.

The default Supabase template sends a PKCE link (`?code=…`) and no code. The
callback still accepts that, but it only works in the browser that asked.

## Supabase settings (per project: scan-home-dev and scan-home-prod)

### Authentication → Emails → Magic Link template

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

`{{ .RedirectTo }}` is the `emailRedirectTo` the app sends
(`<origin>/auth/callback`), so the same template serves develop, previews and
production. That origin must be in Authentication → URL Configuration →
Redirect URLs.

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
