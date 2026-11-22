# Auth edge-case matrix

How the OTP sign-in lifecycle behaves across the scenarios that matter, and
where each is handled. "Provider" means Supabase Auth owns it (it makes,
rate-limits, expires and single-use-consumes the code); "app" means this
repo's code; "DB" means a Postgres function or policy. Tests are named where
they exist; items marked *manual* need a live Supabase/preview to confirm.

## OTP lifecycle
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Correct code | Provider (`verifyOtp`) | session created | manual / E2E |
| Wrong / expired / reused / revoked code | Provider | rejected, generic message | manual / E2E |
| Code for another user or transaction | Provider | rejected (code is bound to identifier) | manual |
| Concurrent verify of one code | Provider (single-use) | at most one succeeds | manual |

## OTP input (our UI)
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Empty / partial | app | submit disabled until full length | — |
| Letters / symbols / whitespace / pasted | app | stripped to digits (`replace(/\D/g, "")`) | manual |
| Leading zeros | app | preserved (string, never parsed as number) | manual |
| Mobile autofill | app | `autoComplete="one-time-code"`, auto-submits at full length | manual |

## Resending
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Resend cooldown | app (30s UI) + provider (server cooldown) | button disabled; provider enforces | manual |
| Rapid / concurrent requests, multi-tab, direct API | DB `reserve_otp_send` + provider | per-number 1/30s, 5/hr, 10/day; per-IP 20/hr | `otpBudget.test.ts` |
| Provider/gateway failure, delayed delivery | app | 019 errors are generic; nothing claims delivery that only was accepted | `sms019.test.ts`, `send-sms/route.test.ts` |

## Abuse / cost
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| SMS pumping, flooding one number | DB `reserve_otp_send` | refused once over budget, before 019 is called | `otpBudget.test.ts`, `send-sms/route.test.ts` |
| Bots | app + provider | Turnstile token required when configured | manual |
| List-SMS cost | DB `reserve_sms_send`/`release_sms_send` | 5/hr·20/day; refunded on send failure | `smsAllowance.test.ts`, `list/sms/route.test.ts` |

## Account states & registration
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Suspended / disabled / deleted signs in | DB `my_household_ids` + app `requireUser` | valid code, but no data and `/no-access` | `accountStatus.test.ts` |
| Restore | DB `set_account_status('active')` | access returns | `accountStatus.test.ts` |
| New phone/email | Provider (open registration, by choice) | account + household created by trigger | `accountStatus.test.ts` (trigger) |
| Status change audited | DB | row in `security_events` | `securityLog.test.ts` |

## Session & authorization
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Refresh / multi-tab / reopen | `@supabase/ssr` + middleware | session kept fresh | manual |
| Unauthenticated hits a protected page | app `requireUser` | redirect to `/login` | — |
| Cross-tenant data access | DB RLS (`my_household_ids`) | denied | `journey.test.ts`, `accountStatus.test.ts` |
| Direct device API without signature | app `deviceAuth` | 401 | `deviceAuth.test.ts`, `protocol.test.ts` |

## Sensitive actions / recovery
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| Delete account | app + DB `delete_my_account` | soft-delete, then cut off | `accountDeletion.test.ts` |
| Delete on a stale/borrowed session | app `isRecentAuth` (10 min) | `reauth_required`, no delete | `reauth.test.ts`, `delete/route.test.ts` |
| Export my data | app | own data only; device secret/pairing-code excluded | `export/route.test.ts` |

## Network / failure
| Scenario | Handled by | Result | Test |
|---|---|---|---|
| 019 / provider timeout or error | app | generic error, no PII logged; allowance refunded | `sms019.test.ts`, `list/sms/route.test.ts` |
| DB error in the cost guard | app | fails open (sign-in not blocked) | by design (`otpBudget.ts`) |
| Security-log write fails | app | swallowed; request unaffected | by design (`securityLog.ts`) |

## Open items (need a live environment)
- End-to-end browser flows (phone, email, wrong code, resend, logout, redirect,
  mobile RTL) — PR 5 (Playwright).
- SMS autofill on real iOS/Android; a phone that cannot receive SMS.
- Supabase Auth dashboard settings (OTP expiry, rate limits, CAPTCHA) — see
  `auth-production-checklist.md`.
