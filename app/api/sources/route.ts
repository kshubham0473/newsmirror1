import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Uses service role so it can write — admin only
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET() {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("sources")
    .select("*")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const body = await req.json();
  const { name, rss_url, home_url, language = "en" } = body;

  if (!name || !rss_url || !home_url) {
    return NextResponse.json({ error: "name, rss_url and home_url are required" }, { status: 400 });
  }

  // Validate RSS URL is reachable
  try {
    const test = await fetch(rss_url, {
      headers: { "User-Agent": "NewsMirror/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!test.ok) {
      return NextResponse.json(
        { error: `RSS URL returned ${test.status}. Please check the URL.` },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "RSS URL is not reachable. Please check it and try again." },
      { status: 400 }
    );
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("sources")
    .insert({ name, rss_url, home_url, language })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This RSS URL is already added." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: Request) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = adminClient();
  const { error } = await supabase.from("sources").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function PATCH(req: Request) {
  const { id, ...updates } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const allowed = ["name", "rss_url", "home_url", "language"];
  const filtered = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );

  const supabase = adminClient();
  const { data, error } = await supabase
    .from("sources")
    .update(filtered)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
