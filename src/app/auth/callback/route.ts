import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where the sign-in link from the email lands.
 *
 * Three shapes reach here:
 * - `#access_token=…` (the default Supabase email, asked for with the implicit
 *   flow): the session is in the URL fragment, which the server never sees, so
 *   this sends the browser on to /auth/confirm. A redirect without a fragment of
 *   its own keeps the one it came with.
 * - `?token_hash=…&type=email`: a custom email template. Verified on the server.
 * - `?code=…`: a PKCE link. It only works in the browser that asked for it,
 *   because that browser holds the verifier.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const supabase = await supabaseServer();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  if (supabase && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  } else if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  if (!tokenHash && !code) return NextResponse.redirect(new URL("/auth/confirm", url.origin));
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
