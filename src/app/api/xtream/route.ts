import { NextRequest, NextResponse } from "next/server";
import { getProviderByShortCode, getSelections } from "@/lib/db";
import {
  getLiveCategories,
  getLiveStreams,
  buildM3U,
  type XtreamCredentials,
  type Category,
  type Stream,
} from "@/lib/xtream";
import { enrichStreamsWithEpg, getEpgListings } from "@/lib/epg";

// Cache upstream data per provider (5 min TTL)
interface CacheEntry {
  categories: Category[];
  streams: Stream[];
  fetchedAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedData(providerId: string, creds: XtreamCredentials): Promise<{ categories: Category[]; streams: Stream[] }> {
  const existing = cache.get(providerId);
  if (existing && Date.now() - existing.fetchedAt < CACHE_TTL) {
    return existing;
  }

  console.log(`[Xtream] Fetching upstream data for ${providerId}...`);
  const [categories, streams] = await Promise.all([
    getLiveCategories(creds),
    getLiveStreams(creds),
  ]);
  // Enrich streams with EPG IDs from free sources
  await enrichStreamsWithEpg(streams);
  console.log(`[Xtream] Cached ${streams.length} streams, ${categories.length} categories (EPG enriched)`);

  const entry = { categories, streams, fetchedAt: Date.now() };
  cache.set(providerId, entry);
  return entry;
}

async function getProviderFromRequest(request: NextRequest) {
  const shortCode = request.nextUrl.searchParams.get("username");
  const password = request.nextUrl.searchParams.get("password");

  if (!shortCode || !password) {
    return null;
  }

  const provider = await getProviderByShortCode(shortCode);
  if (!provider) return null;

  return { ...provider, password };
}

// Handles both player_api.php and get.php via rewrites
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("_type"); // set by rewrite
  const action = request.nextUrl.searchParams.get("action");

  const provider = await getProviderFromRequest(request);
  if (!provider) {
    return NextResponse.json({ user_info: { auth: 0 } }, { status: 200 });
  }

  const creds: XtreamCredentials = {
    url: provider.url,
    username: provider.username,
    password: provider.password,
  };

  const selectedIds = new Set(await getSelections(provider.id));

  // get.php — return M3U playlist
  if (type === "m3u") {
    const { categories, streams } = await getCachedData(provider.id, creds);
    const filtered = streams.filter((s) => selectedIds.has(s.stream_id));
    const m3u = buildM3U(creds, filtered, categories);

    return new NextResponse(m3u, {
      headers: {
        "Content-Type": "audio/mpegurl",
        "Content-Disposition": 'inline; filename="playlist.m3u"',
      },
    });
  }

  // player_api.php — JSON API
  if (action === "get_live_categories") {
    const { categories, streams } = await getCachedData(provider.id, creds);

    // Only return categories that have selected streams
    const usedCategoryIds = new Set(
      streams.filter((s) => selectedIds.has(s.stream_id)).map((s) => s.category_id)
    );
    const filtered = categories.filter((c) => usedCategoryIds.has(c.category_id));
    return NextResponse.json(filtered);
  }

  if (action === "get_live_streams") {
    const categoryId = request.nextUrl.searchParams.get("category_id");
    const { streams } = await getCachedData(provider.id, creds);
    let filtered = streams.filter((s) => selectedIds.has(s.stream_id));
    if (categoryId) {
      filtered = filtered.filter((s) => s.category_id === categoryId);
    }
    // Add direct_source so clients stream directly from the provider
    const providerBase = creds.url.replace(/\/+$/, "");
    const withDirectSource = filtered.map((s) => ({
      ...s,
      direct_source: `${providerBase}/live/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${s.stream_id}.ts`,
    }));
    return NextResponse.json(withDirectSource);
  }

  if (action === "get_short_epg" || action === "get_simple_data_table") {
    const streamId = request.nextUrl.searchParams.get("stream_id");
    if (!streamId) return NextResponse.json({ epg_listings: [] });

    // Find the stream to get its EPG channel ID
    const { streams } = await getCachedData(provider.id, creds);
    const stream = streams.find((s) => s.stream_id === parseInt(streamId, 10));
    if (!stream || !stream.epg_channel_id) {
      return NextResponse.json({ epg_listings: [] });
    }

    const listings = await getEpgListings(stream.epg_channel_id);
    return NextResponse.json({ epg_listings: listings });
  }

  if (action === "get_vod_categories" || action === "get_vod_streams" ||
      action === "get_series_categories" || action === "get_series") {
    return NextResponse.json([]);
  }

  // Default: account info (auth check)
  return NextResponse.json({
    user_info: {
      auth: 1,
      username: provider.short_code,
      password: provider.password,
      status: "Active",
      exp_date: "9999999999",
      is_trial: "0",
      active_cons: "0",
      created_at: provider.created_at,
      max_connections: "1",
      allowed_output_formats: ["m3u8", "ts", "rtmp"],
    },
    server_info: {
      url: request.nextUrl.hostname,
      port: request.nextUrl.port || (request.nextUrl.protocol === "https:" ? "443" : "80"),
      https_port: "443",
      server_protocol: request.nextUrl.protocol === "https:" ? "https" : "http",
      rtmp_port: "0",
      timezone: "UTC",
      timestamp_now: Math.floor(Date.now() / 1000),
      time_now: new Date().toISOString(),
    },
  });
}
