import { createServerClient as _create, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export function createServerClient() {
  const cookieStore = cookies();
  return _create(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — writes ignored,
            // middleware handles session persistence
          }
        },
      },
    }
  );
}
