# חיבור Supabase

האפליקציה משתמשת ב־Supabase לשלושה דברים: מסד הנתונים (Postgres), התחברות עם קישור במייל, ועדכון חי של הרשימה (Realtime).
הבידוד בין משקי בית נאכף במסד הנתונים עצמו (Row Level Security), לא רק בקוד.

## הקמה (פעם אחת לכל סביבה)

מומלץ שני פרויקטים: אחד ל־Development/Preview ואחד ל־Production.

1. יוצרים פרויקט ב־[supabase.com](https://supabase.com) (אזור קרוב, למשל Frankfurt).
2. מריצים את המיגרציות:
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
   (אפשר גם להדביק את הקבצים מ־`supabase/migrations/` לפי הסדר ב־SQL Editor.)
3. Authentication → URL Configuration:
   - **Site URL**: כתובת הסביבה (למשל `https://scan-home.vercel.app`).
   - **Redirect URLs**: `https://<domain>/auth/callback`, ולסביבת הפיתוח גם `https://*-<team>.vercel.app/auth/callback` ו־`http://localhost:3000/auth/callback`.
4. ב־Vercel → Project → Settings → Environment Variables, לכל סביבה:
   | משתנה | מאיפה |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API (anon / publishable) |
   | `DATABASE_URL` | Project Settings → Database → Connection string → **Transaction pooler** (פורט 6543) |

   `DATABASE_URL` הוא סוד ונשאר רק בשרת. מפתח ה־service role לא נדרש בכלל.

## מי ניגש לאן

- **אנשים** (הדפדפן) ניגשים ישירות ל־Supabase עם ה־JWT שלהם. רואים רק את משק הבית שלהם. אין להם גישה ל־`secret_hash`, לקוד השיוך של המכשיר, לטוקנים של שיוך או לפונקציות של המכשיר.
- **מכשירים** מדברים רק עם `/api/v1/*` בשרת Next.js. כל בקשה חתומה ב־HMAC, והשרת ניגש למסד דרך `DATABASE_URL`.

## מיגרציות חדשות

כל שינוי סכימה הוא קובץ חדש ב־`supabase/migrations/` (לא עורכים קובץ שכבר רץ). הבדיקות ב־CI מריצות את כל המיגרציות על Postgres נקי, כך ששגיאה תתגלה ב־PR.
שימו לב: Supabase נותן כברירת מחדל הרשאות מלאות על כל טבלה חדשה ל־`anon` ול־`authenticated`. כל מיגרציה שמוסיפה טבלה צריכה `ENABLE ROW LEVEL SECURITY` ו־`REVOKE`/`GRANT` מפורשים, כמו במיגרציה הראשונה.
