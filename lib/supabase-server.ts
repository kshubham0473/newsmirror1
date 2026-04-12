import { createClient } from "@supabase/supabase-js";

// Server-side Supabase client for use in Server Components and Route Handlers.
// Uses the anon key — safe for read-only public data (sources, articles).
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
