import { createClient } from "@supabase/supabase-js";

/**
 * Cookie-FREE Supabase client for public, cacheable pages (feed, threads).
 *
 * The cookie-bound createServerClient forces Next.js to render the route
 * dynamically on EVERY request (cookies() opts out of static rendering),
 * which silently disabled ISR and made each cold PWA start wait 30s+ on a
 * cold lambda + heavy query. Public data needs no session — with this client
 * the pages are statically regenerated on the `revalidate` interval and
 * served instantly from cache.
 */
export function createStaticClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
