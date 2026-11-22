# State Machine של המכשיר

הלוח מנוהל על ידי שלושה state machines שונים, בשכבות שונות. הם קיימים בקוד
כבר — המסמך הזה רק מתעד אותם, לא מוסיף state חדש.

## 1. מכונת המצבים הראשית (`firmware/src/main.cpp`)

```cpp
enum class State { Boot, Portal, Connecting, SyncTime, Registering, WaitingToPair, Ready };
```

```
Boot
  │  hasCredentials()? ──no──► Portal ──submit──► Connecting
  │                                                   │
  └──yes──► Connecting                                │ WiFi ok
               │ WiFi fail → Portal (clearCredentials)│
               ▼                                      ▼
            SyncTime ──NTP fail──► נשאר ב-SyncTime (retry עם backoff)
               │ NTP ok
               ▼
           Registering ──שרת לא זמין──► נשאר (retry)
               │ נרשם, לא משויך
               ▼
         WaitingToPair ──claim-status הצליח──► Ready
               │
               ▼
             Ready ──heartbeat/flushQueue/handleCommand בלולאה──
```

- **Portal**: `Provisioning::startPortal()` — SoftAP + captive portal
  (ראו `docs/architecture.md` לזרימה המלאה). כולל safe-mode handling (מופעל
  גם ב-Safe Mode כדי לאפשר תיקון מרחוק).
- **WaitingToPair → Ready**: `Uplink::checkClaimed()` נבדק כל `CLAIM_POLL_INTERVAL_MS`.
- כל מעבר state נשמר דרך `Feedback::setState(...)` כך שהנורית משקפת את
  המצב תמיד (ראה טבלה למטה).

## 2. מצב ה-Provisioning portal (`firmware/src/device/Provisioning.h`)

```cpp
enum class Progress {
  WaitingForInput, Connecting, WifiFailed, SyncingTime,
  Registering, ServerFailed, WaitingToPair, Paired,
};
```

זה המצב שהעמוד בטלפון (`/progress`) מציג בזמן אמת דרך `GET /status`
(polling כל 1.5 שניות) — עדכון לייב בזמן שהלוח מתחבר, בלי לדרוש רענון.
`WifiFailed`/`ServerFailed` הם ה"ענפי שגיאה" שחוזרים ל-`WaitingForInput`
(כפתור "נסה שוב" ב-`handleRetry`).

## 3. חיווי LED/באזר (`firmware/src/hmi/Feedback.h`)

| מצב | צבע | דפוס |
|---|---|---|
| `Booting` | אפור | קבוע |
| `Provisioning` | כחול | נושם (breathing) |
| `Connecting` | כחול | נושם |
| `WaitingToPair` | סגול | נושם איטי |
| `Ready` | ירוק | קבוע |
| `Queued` | כתום | קבוע — סריקות נשמרות מקומית |
| `Error` | אדום | קבוע |
| `Updating` | מגנטה | נושם |
| **Locate (overlay)** | **לבן** | **סטרובו מהיר (120ms)**, על גבי כל מצב אחר, ל-4 שניות |

ה-overlay של Locate (`Feedback::flashLocate()`) לא משנה את ה-state —
בתום החלון הוא חוזר בדיוק למצב שהיה לפני כן.

## כפתור BOOT (`firmware/src/main.cpp`)

| לחיצה | פעולה |
|---|---|
| קצרה | (אין פעולה מוגדרת למוצר הזה) |
| ממושכת (10,000ms, `FACTORY_RESET_HOLD_MS`) | איפוס לברירת מחדל: `Provisioning::clearCredentials()` + `DeviceIdentity::factoryReset()` |

הכפתור נבדק בכל `pump()` — כלומר גם בזמן שהלוח "תפוס" (מחבר רשת/מסנכרן
שעון), לא רק כשהוא ב-Ready. זו דרישת עיצוב מכוונת (ראו ההערה בקוד).

## פקודות מרחוק — מה קורה בלוח (`handleCommand`, PR `feat/device-firmware-commands`)

| פקודה | מה קורה בלוח | מתאפס? | יכולה לדווח `done`? |
|---|---|---|---|
| `locate` | `Feedback::flashLocate()` | לא | כן — ה-ack נשלח בפעימה הבאה |
| `reboot` | `ESP.restart()` מיידי | כן | לא — אין פעימה נוספת לפני האתחול |
| `factory_reset` | `clearCredentials()` + `factoryReset()` + restart | כן | לא |
| `reprovision` | `clearCredentials()` + restart (שומר זהות) | כן | לא |

## מה נותר כ"לא ממומש"

- אין state ייעודי ל-`FirmwareUpdating`/`Error` כ-state נפרד במכונה הראשית —
  OTA (`Ota::tick()`) רץ "מתחת" ל-state הנוכחי, לא כ-state משלו. ה-LED
  מראה `Updating` אבל ה-state machine הראשית לא יודעת על זה ישירות.
- אין ack לפקודות שמאפסות את הלוח (ראה טבלה) — מתועד כמגבלה מכוונת, לא באג.
