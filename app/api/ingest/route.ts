import { NextResponse } from "next/server";

// Vercel Cron calls this with CRON_SECRET in the Authorization header.
// Manual calls can use x-ingest-secret header instead.
// Phases: ingest | summarise | classify | cluster | enrich-images
//
// Cron schedule (vercel.json):
//   /api/ingest?phase=ingest      → every 15 min
//   /api/ingest?phase=summarise   → every 15 min (offset by 5 min)
//   /api/ingest?phase=classify    → every 30 min
//   /api/ingest?phase=cluster     → every 6h

export const maxDuration = 60; // seconds — enough for Gemini summarise phase

export async function GET(request: Request) {
  // Auth: accept either Vercel cron secret OR manual ingest secret
  const authHeader = request.headers.get("authorization");
  const manualSecret = request.headers.get("x-ingest-secret");

  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validManual = manualSecret === process.env.INGEST_SECRET;

  if (!validCron && !validManual) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Missing SUPABASE env vars" }, { status: 500 });
  }

  // Read phase from query param, default to "ingest"
  const { searchParams } = new URL(request.url);
  const phase = searchParams.get("phase") ?? "ingest";

  const functionUrl = `${supabaseUrl}/functions/v1/ingest-articles?phase=${phase}`;
  console.log(`[ingest route] Calling phase=${phase}`, functionUrl);

  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  console.log(`[ingest route] phase=${phase} status=${res.status}`, text.slice(0, 500));

  try {
    return NextResponse.json({ phase, ...JSON.parse(text) });
  } catch {
    return NextResponse.json({ phase, raw: text, status: res.status });
  }
}
