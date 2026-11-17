import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Where the sign-in link from the email lands.
 *
 * Two shapes reach here:
 * - `?token_hash=…&type=email`: the link from our own email template. It is
 *   verified on the server, so it works in any browser, including a mail
 *   app's built-in viewer on a phone.
 * - `?code=…`: Supabase's default template (PKCE). It only works in the
 *   browser that asked for the link, because that browser holds the verifier.
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
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
