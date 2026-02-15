import { NextRequest, NextResponse } from "next/server";
import { upsertProvider, saveSelections, getSelections, getProvider, getOrCreateShortCode } from "@/lib/db";
import { getSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionToken, streamIds } = body;

    if (!sessionToken || !Array.isArray(streamIds)) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Try server-side session first, fall back to database
    const session = getSession(sessionToken);
    const provider = getProvider(sessionToken);

    if (session) {
      // Session active — persist/update provider in DB (password not stored)
      upsertProvider(sessionToken, session.url, session.username);
    } else if (!provider) {
      // Neither session nor DB has this provider
      return NextResponse.json({ error: "Session expired, please log in again" }, { status: 401 });
    }

    // Save the selections
    saveSelections(sessionToken, streamIds);

    const shortCode = getOrCreateShortCode(sessionToken);
    return NextResponse.json({ token: sessionToken, shortCode, count: streamIds.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const provider = getProvider(token);
    if (!provider) {
      return NextResponse.json({ error: "Provider not found" }, { status: 404 });
    }

    const streamIds = getSelections(token);
    return NextResponse.json({ streamIds });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
