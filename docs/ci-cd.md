# תהליך ה-CI/CD של scan-home

## שתי סביבות

| סביבה | ענף | איפה רץ | משתני סביבה ב-Vercel |
|---|---|---|---|
| **Development** | `develop` | Vercel Preview עם כתובת קבועה לענף | Preview (מסונן לענף `develop`) |
| **Production** | `main` | Vercel Production | Production |

בנוסף, כל PR מקבל **Preview** משלו עם לינק ייחודי, כדי לראות את השינוי לפני merge.

## איך עובדים ביום-יום

1. פותחים ענף מ-`develop`: `git checkout -b feature/my-change develop`
2. עושים push ופותחים PR אל `develop`.
3. GitHub Actions מריץ lint, בדיקת טיפוסים, טסטים ו-build. Vercel מעלה Preview.
4. כשה-CI ירוק, עושים merge. השינוי עולה אוטומטית לסביבת Development.
5. כשרוצים לשחרר: פותחים PR מ-`develop` אל `main`. אחרי CI ירוק ו-merge, זה עולה ל-Production.

## הגנות

- אי אפשר לדחוף ישירות ל-`main` או ל-`develop`, רק דרך PR.
- PR לא ניתן ל-merge אם ה-CI (`Lint, typecheck, test, build`) נכשל.
- אסור force push ואסור למחוק את הענפים האלה.

## גיבוי ושחזור

- **קוד:** כל ההיסטוריה ב-GitHub. בנוסף, ה-workflow `Backup` יוצר פעם בשבוע קובץ `git bundle`
  של כל הענפים ושומר אותו 90 יום (Actions → Backup → Artifacts). אפשר להריץ אותו גם ידנית.
  שחזור: `git clone scan-home-YYYY-MM-DD.bundle scan-home`
- **Deploys:** Vercel שומר כל deploy. אם משהו נשבר ב-Production, נכנסים ל-Deployments,
  בוחרים deploy קודם ולוחצים **Instant Rollback**.
- **משתני סביבה:** נשמרים ב-Vercel בלבד, לא בקוד. רשימת השמות ב-`.env.example`.

## משתני סביבה

- מקומית: מעתיקים `.env.example` ל-`.env.local` וממלאים.
- ב-Vercel: Project → Settings → Environment Variables, וקובעים לכל משתנה אם הוא ל-Production,
  ל-Preview (אפשר לסנן לענף `develop` בלבד) או לשניהם.
