# תוכנית בדיקות — ניהול מכשירים

מכסה את שכבת האפליקציה/שרת (הצטרפות, פקודות מרחוק, שיתוף, RBAC). לתרחישי
כשל קושחה על החומרה עצמה (watchdog, OTA, USB, ניתוקי חשמל) ראו
`firmware/test/scenarios.md` — 31 תרחישים, 14 מהם מוכחים על חומרה אמיתית.
להתחברות (OTP) ראו `auth-edge-cases.md`.

לכל תרחיש: תנאי מוצא, צעדים, תוצאה מצופה, התנהגות שחזור. מסומן **אוטומט**
כשיש בדיקה רצה בפועל (לא רק מתוכננת), עם שם הקובץ.

## הצטרפות מכשיר (adopt)

| # | תרחיש | תנאי מוצא | צעדים | תוצאה מצופה | אוטומט |
|---|---|---|---|---|---|
| A1 | הצטרפות תקינה | מכשיר רשום, לא משויך | `adopt_device(serial)` ע"י חבר פעיל | `household_id` מוקצה, status='active', סריקות שהיו held נכנסות לרשימה | `deviceAdopt.test.ts` |
| A2 | מכשיר לא נראה > 10 דק' | מכשיר ישן, לא עודכן | ניסיון אימוץ | מסורב, לא מוצג ברשימת `list_adoptable_devices` | `deviceAdopt.test.ts` |
| A3 | מירוץ אימוץ (שני בעלים) | מכשיר אחד, שני משתמשים | שניהם מנסים לאמץ כמעט בו-זמנית | הראשון מצליח, השני מסורב ("כבר משויך") | `deviceAdopt.test.ts` |
| A4 | אימוץ חוזר (אידמפוטנטי) | המכשיר כבר שלי | אימוץ נוסף | מצליח, replayed_scans=0, לא נוצרת כפילות | `deviceAdopt.test.ts` |
| A5 | הצטרפות דרך הדפדפן, לא מתפתח captive portal | טלפון מחובר ל-ScanCart-XXXX | לחיצה על "פתח את דף ההגדרה" | עובר ל-192.168.4.1 | ידני — דורש מכשיר/חומרה |

## פקודות מרחוק

| # | תרחיש | תנאי מוצא | צעדים | תוצאה מצופה | אוטומט |
|---|---|---|---|---|---|
| C1 | מסירה ואישור (locate) | מכשיר מחובר | `issue_device_command(locate)` → heartbeat → heartbeat עם ack | pending→sent→done | `deviceCommands.test.ts` |
| C2 | פקודה לא נמסרת בזמן | TTL פג לפני heartbeat | heartbeat מגיע אחרי `expires_at` | status='expired', command לא נמסר למכשיר | `deviceCommands.test.ts` |
| C3 | אישור אידמפוטנטי | פקודה כבר 'done' | ack כפול מגיע | הסטטוס לא משתנה חזרה | `deviceCommands.test.ts` |
| C4 | viewer מנסה לשלוח פקודה | משתמש עם role='viewer' | `issue_device_command` | שגיאת הרשאה, שום דבר לא נוצר | `deviceCommands.test.ts` |
| C5 | locate על חומרה אמיתית | לוח מחובר, קושחה מעודכנת (`feat/device-firmware-commands`) | לחיצה על "אתר מכשיר" באפליקציה | סטרובו לבן + 3 ביפים תוך פחות מדקה | ידני — דורש צריבה ללוח |
| C6 | reboot/factory_reset/reprovision | — | שליחת כל אחת מהפקודות | הלוח מתאפס; ה-UI מציג "נשלח" ולא נתקע מחכה ל-"בוצע" | `CommandButton.tsx` (לוגיקת FIRES_AND_FORGETS) + ידני לאימות על חומרה |

## שיתוף ו-RBAC

| # | תרחיש | תנאי מוצא | צעדים | תוצאה מצופה | אוטומט |
|---|---|---|---|---|---|
| S1 | הזמנה ואישור | בעלים במשק בית | `create_household_invite` → `accept_household_invite` | המשתמש המוזמן מקבל גישה לרשימה ולמכשירים | `deviceSharing.test.ts` |
| S2 | אישור הזמנה מכתובת שגויה | הזמנה נשלחה ל-X | משתמש Y מנסה לאשר | מסורב | `deviceSharing.test.ts` |
| S3 | לא-בעלים מנסה להזמין | role='member' | `create_household_invite` | שגיאת הרשאה | `deviceSharing.test.ts` |
| S4 | הגנת "בעלים אחרון" | בעלים יחיד | ניסיון הסרה/שינוי תפקיד עצמי, או `leave_household` | מסורב בכל המקרים | `deviceSharing.test.ts` |
| S5 | הסרת חבר חוסמת גישה | חבר פעיל | `remove_household_member` | `my_household_ids()` לא כולל יותר את המשק בית | `deviceSharing.test.ts` |
| S6 | שחרור מכשיר (לפני מכירה) | בעלים | `release_device` | status='unclaimed', household_id=NULL, ניתן לאימוץ חדש | `deviceSharing.test.ts` |
| S7 | viewer לא יכול לשנות שם מכשיר | role='viewer' | `UPDATE devices SET name=...` ישירות (RLS) | 0 שורות משתנות | `deviceRename.test.ts` |

## אפליקציה — מסך פרטי מכשיר

| # | תרחיש | תוצאה מצופה | אוטומט |
|---|---|---|---|
| D1 | שינוי שם ע"י member/owner | נשמר, מוצג "נשמר ✓" | `DeviceDetail.test.tsx` |
| D2 | הסתרת פעולות owner-only מ-viewer | "איפוס לברירת מחדל" ו"הסרת המכשיר" לא מוצגים | `DeviceDetail.test.tsx` |
| D3 | מכשיר לא נמצא / לא שלי | הודעה ברורה, לא קורס | `DeviceDetail.test.tsx` |

## רגרסיה — לפני כל מיזוג

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npx vitest run
npm run typecheck && npm run lint && npm run build
cd firmware && ./run-tests.sh   # + CI: pio run -e usb / -e production
```

## מה עדיין ידני בלבד (דורש חומרה אמיתית)

- A5, C5, C6 לעיל.
- 17 מתוך 31 תרחישי `firmware/test/scenarios.md` (handoff O16).
- הלוח הקיים סובל מהתאפסות חזרתית (handoff O4) — מומלץ לתקן זאת **לפני**
  שמנסים לאמת C5/C6 על החומרה, אחרת קשה להבחין בין הבעיות.
