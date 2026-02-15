import { NextRequest, NextResponse } from "next/server";
import { getProvider, getSelections } from "@/lib/db";
import { getLiveStreamsByIds, getLiveCategories, buildM3U, type XtreamCredentials } from "@/lib/xtream";
import { enrichStreamsWithEpg } from "@/lib/epg";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const password = request.nextUrl.searchParams.get("password");
    console.log(`[M3U] Request for token: ${token}`);

    if (!password) {
      return new NextResponse("#EXTM3U\n# Missing password parameter", {
        status: 200,
        headers: { "Content-Type": "audio/mpegurl" },
      });
    }

    const provider = getProvider(token);
    if (!provider) {
      console.log("[M3U] Provider not found");
      return new NextResponse("#EXTM3U\n# Provider not found", {
        status: 200,
        headers: { "Content-Type": "audio/mpegurl" },
      });
    }

    const streamIds = getSelections(token);
    console.log(`[M3U] Found ${streamIds.length} selected channels`);

    if (streamIds.length === 0) {
      return new NextResponse("#EXTM3U\n# No channels selected", {
        status: 200,
        headers: { "Content-Type": "audio/mpegurl" },
      });
    }

    const creds: XtreamCredentials = {
      url: provider.url,
      username: provider.username,
      password,
    };

    // Build M3U from Xtream API data instead of fetching get.php
    const [streams, categories] = await Promise.all([
      getLiveStreamsByIds(creds, new Set(streamIds)),
      getLiveCategories(creds),
    ]);

    await enrichStreamsWithEpg(streams);
    console.log(`[M3U] Building M3U with ${streams.length} streams (EPG enriched)`);
    const m3u = buildM3U(creds, streams, categories);

    return new NextResponse(m3u, {
      headers: {
        "Content-Type": "audio/mpegurl",
        "Content-Disposition": 'inline; filename="playlist.m3u"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[M3U] Error: ${message}`);
    return new NextResponse(`#EXTM3U\n# Error: ${message}`, {
      status: 200,
      headers: { "Content-Type": "audio/mpegurl" },
    });
  }
}
