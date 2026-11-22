# ארכיטקטורת המערכת

סקירה של איך scan home מחובר מקצה לקצה: הלוח, השרת, האפליקציה, ומסד הנתונים.
נכתב כהשלמה לתוכנית ניהול המכשירים (ראו `device-state-machine.md`,
`error-matrix.md`, `qa-test-plan.md`, `production-readiness.md`).

## למה הסטאק הזה, ולא BLE/MQTT/אפליקציה native

התוכנית המקורית למוצר (בסגנון Switcher) ביקשה צימוד ב-BLE, אפליקציית native,
ו-MQTT over TLS לשליטה מרחוק. הוחלט במפורש **לא** ללכת בכיוון הזה, כי:

- **האפליקציה היא PWA (דפדפן).** ל-iOS אין Web Bluetooth, כך שצימוד BLE מהדפדפן
  **לא אפשרי ב-iPhone** — תנאי חוסם, לא סתם העדפה.
- **אין היום broker MQTT**, והמודל הקיים (HTTPS pull דרך heartbeat) מכוסה
  באבטחה (HMAC, timestamp, TLS) ועובד.
- הקושחה היא Arduino, לא ESP-IDF עם ה-provisioning המאוחד.

המסקנה: **להשלים** את המודל הקיים (SoftAP + HTTPS pull) עד שהוא מכיל את כל
מה שהתוכנית דרשה בפועל — זהות מאובטחת, הצטרפות, שליטה מרחוק אמינה, שיתוף,
RBAC, OTA חתום — בלי לשנות טכנולוגיית בסיס. מעבר ל-native+BLE+MQTT אפשרי
כשלב עתידי נפרד, לא כחלק מהעבודה הזו.

## תרשים זרימה: הצטרפות מכשיר (onboarding)

```
┌──────────┐   SoftAP "ScanCart-XXXX"   ┌──────────────┐
│  הלוח    │ ─────────────────────────► │  הטלפון      │
│ (ESP32)  │ ◄───────────────────────── │ (מחובר ל-AP) │
└────┬─────┘   192.168.4.1 (portal)     └──────────────┘
     │ בחירת רשת בית + סיסמה (אין קוד בטופס)
     ▼
┌──────────────────────────────────────────────┐
│ Provisioning::consumeSubmission → saveCredentials │
│ מתחבר ל-WiFi → מסנכרן שעון (NTP) → נרשם לשרת   │
└───────────────────────┬───────────────────────┘
                         │ POST /api/v1/devices/register (unsigned)
                         ▼
                 devices row, status='unclaimed'
                         │
     ┌───────────────────┴────────────────────┐
     │  (האפליקציה, בחשבון של המשתמש)          │
     │  list_adoptable_devices() → מציג לסורק  │
     │  "זה שלי" → adopt_device(serial)        │
     └───────────────────┬────────────────────┘
                         ▼
          household_id מוקצה, status='active'
          סריקות שהיו 'held' נשמעות (replay)
```

## תרשים זרימה: פקודה מרחוק (Locate, לדוגמה)

```
┌────────────┐  issue_device_command(device_id,'locate')  ┌──────────┐
│ האפליקציה  │ ───────────────────────────────────────────►│  שרת     │
│ (בעלים/חבר)│                                              │(Supabase)│
└────────────┘                                              └────┬─────┘
                                                                   │ INSERT device_commands(status='pending')
                                                                   │ devices.pending_command = {id,action,payload}
                                                                   ▼
┌──────────┐  POST /api/v1/devices/heartbeat (כל דקה)      ┌──────────┐
│  הלוח    │ ───────────────────────────────────────────► │  שרת     │
│          │ ◄─────────────────────────────────────────── │          │
└────┬─────┘  {command:{id,action:'locate'}}  status→'sent'└──────────┘
     │ handleCommand(): Feedback::flashLocate()
     │ זוכר את ה-id לאישור בפעימה הבאה
     ▼
┌──────────┐  heartbeat הבא: command_ack:{id,status:'done'} ┌──────────┐
│  הלוח    │ ───────────────────────────────────────────► │  שרת     │
└──────────┘                                               └────┬─────┘
                                                                  │ status='done'
                                                                  ▼
                                               האפליקציה (Realtime/poll) מציגה "בוצע ✓"
```

**חשוב:** `reboot`, `factory_reset` ו-`reprovision` גורמים ללוח להתאפס מיידית,
לפני שהוא יכול לדווח `command_ack` — אין "done" אמיתי לפעולות האלו, רק "sent".
ה-UI (`CommandButton.tsx`) מתייחס אליהן כ-fire-and-forget. `expires_at` מבטיח
שפקודה שלא נמסרה בזמן (`device_commands.status='expired'`) **לא תבוצע מאוחר**.

## רכיבים

| רכיב | טכנולוגיה | תפקיד |
|---|---|---|
| קושחה | ESP32-S3, C++/Arduino, PlatformIO | סריקה, SoftAP portal, HMAC, heartbeat, OTA חתום |
| שרת/API | Next.js (App Router) על Vercel | מסלולי device API, auth hook, SMS |
| מסד נתונים | Supabase (Postgres + RLS + Realtime) | כל הלוגיקה העסקית כ-SECURITY DEFINER functions |
| אפליקציה | Next.js + React, PWA | UI משתמש — רשימה, מכשירים, שיתוף, חשבון |

## אבטחה — הפניה

ראו `firmware-security.md` (מה מוגן ומה חוב מוצהר), `auth-edge-cases.md`
ו-`auth-production-checklist.md` (OTP), ו-`device-protocol.md` (חתימת HMAC
של תקשורת המכשיר). ה-RBAC של ניהול המכשירים (owner/member/viewer) מוגדר
ב-`supabase/migrations/20261117000001_init.sql` ואוכף דרך `my_household_ids()`
ו-`my_role_in()` (ראו המיגרציות מ-2026-11-22).
