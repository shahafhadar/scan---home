import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Where the sign-in link from the email lands. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const supabase = await supabaseServer();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/", url.origin));
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
