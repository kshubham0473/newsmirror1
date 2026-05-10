import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const secret = request.headers.get("x-ingest-secret");
  if (secret !== process.env.INGEST_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing SUPABASE env vars" },
      { status: 500 }
    );
  }

  const functionUrl = `${supabaseUrl}/functions/v1/ingest-articles`;

  console.log("Calling:", functionUrl);

  const res = await fetch(functionUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const text = await res.text();
  console.log("Function response:", res.status, text);

  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    return NextResponse.json({ raw: text, status: res.status });
  }
}