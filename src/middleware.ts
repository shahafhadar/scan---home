import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";

/** Keeps the Supabase session fresh on every page load. */
export async function middleware(request: NextRequest) {
  const config = supabaseConfig();
  let response = NextResponse.next({ request });
  if (!config) return response;

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Pages only: the device API and static files never carry a session.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)"],
};
