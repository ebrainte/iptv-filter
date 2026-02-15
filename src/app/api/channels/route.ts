import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { getAccountInfo, getLiveCategories, getLiveStreams, type XtreamCredentials } from "@/lib/xtream";
import { findProviderByCredentials } from "@/lib/db";
import { setSession, getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, username, password } = body;

    if (!url || !username || !password) {
      return NextResponse.json({ error: "Missing credentials" }, { status: 400 });
    }

    const creds: XtreamCredentials = { url, username, password };

    // Validate credentials
    await getAccountInfo(creds);

    // Fetch categories and streams in parallel
    const [categories, streams] = await Promise.all([
      getLiveCategories(creds),
      getLiveStreams(creds),
    ]);

    // Reuse existing provider token or create a new session token
    const existing = findProviderByCredentials(url, username, password);
    const sessionToken = existing?.id ?? uuidv4();

    // Store everything server-side
    setSession(sessionToken, { url, username, password, categories, streams });

    return NextResponse.json({
      sessionToken,
      channelCount: streams.length,
      categoryCount: categories.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: fetch channel data from server-side session
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const session = getSession(token);
  if (!session) {
    return NextResponse.json({ error: "Session expired, please log in again" }, { status: 404 });
  }

  return NextResponse.json({
    categories: session.categories,
    streams: session.streams,
  });
}
