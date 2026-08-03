/** @type {import('next').NextConfig} */
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
  buildExcludes: [/middleware-manifest\.json$/],
  // News must never be served from a stale cache. The default strategy paints
  // the last cached page on cold open — after days away that's days-old news.
  // Pages and RSC payloads go network-first with a short timeout; the cache is
  // strictly an offline fallback with a short lifetime. Static assets keep
  // their long-lived caching (handled by the defaults below this entry).
  runtimeCaching: [
    {
      urlPattern: ({ request, url }) =>
        self.origin === url.origin &&
        (request.mode === "navigate" ||
          request.destination === "document" ||
          url.search.includes("_rsc=")),
      handler: "NetworkFirst",
      options: {
        cacheName: "pages-fresh",
        networkTimeoutSeconds: 4,
        expiration: { maxEntries: 32, maxAgeSeconds: 60 * 30 },
        cacheableResponse: { statuses: [0, 200] },
      },
    },
    {
      urlPattern: ({ url }) => self.origin === url.origin && url.pathname.startsWith("/_next/static/"),
      handler: "CacheFirst",
      options: {
        cacheName: "next-static",
        expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
      },
    },
    {
      urlPattern: ({ request }) => ["style", "script", "worker", "font"].includes(request.destination),
      handler: "StaleWhileRevalidate",
      options: { cacheName: "assets", expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 } },
    },
    {
      urlPattern: ({ request }) => request.destination === "image",
      handler: "CacheFirst",
      options: { cacheName: "images", expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 3 } },
    },
  ],
});

const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

module.exports = withPWA(nextConfig);