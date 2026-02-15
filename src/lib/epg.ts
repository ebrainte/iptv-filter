// EPG sources and channel name matching
import { gunzipSync } from "zlib";

export const EPG_SOURCES = [
  { url: "https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz", gzipped: true },
  { url: "https://raw.githubusercontent.com/globetvapp/epg/main/Argentina/argentina1.xml", gzipped: false },
];

interface EpgChannel {
  id: string;
  displayName: string;
  normalized: string;
}

export interface EpgProgramme {
  start: string;
  stop: string;
  channel: string;
  title: string;
  description: string;
}

interface EpgData {
  channels: EpgChannel[];
  programmes: Map<string, EpgProgramme[]>; // keyed by channel ID
}

let epgData: EpgData | null = null;
let epgFetchedAt = 0;
const EPG_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

function normalizeForMatch(name: string): string {
  return name
    .toUpperCase()
    .replace(/^(AR|LA|ARGENTINA|CANAL)\s*[:.]?\s*/i, "")
    .replace(/\s*(HD|SD|FHD|UHD|ᴴᴰ|ᵁᴴᴰ|ᴿᴬᵂ|ʰᵉᵛᶜ|⁶⁰ᶠᵖˢ|³⁸⁴⁰ᴾ)\s*/g, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/[.]/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEpgId(id: string): string {
  return id
    .toUpperCase()
    .replace(/\.AR$/i, "")
    .replace(/^CANAL\.\s*/i, "")
    .replace(/[.]/g, " ")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/&amp;/g, "AND")
    .replace(/&/g, "AND")
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Convert XMLTV time format "20260214180000 +0000" to epoch
function xmltvTimeToEpoch(timeStr: string): number {
  // Format: YYYYMMDDHHmmss +ZZZZ
  const match = timeStr.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\s*([+-]\d{4})?/);
  if (!match) return 0;
  const [, y, m, d, h, min, s, tz] = match;
  const iso = `${y}-${m}-${d}T${h}:${min}:${s}${tz ? tz.slice(0, 3) + ":" + tz.slice(3) : "Z"}`;
  return Math.floor(new Date(iso).getTime() / 1000);
}

async function fetchEpgData(): Promise<EpgData> {
  if (epgData && Date.now() - epgFetchedAt < EPG_CACHE_TTL) {
    return epgData;
  }

  const channels: EpgChannel[] = [];
  const programmes = new Map<string, EpgProgramme[]>();
  const seenNormalized = new Set<string>();

  for (const source of EPG_SOURCES) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) continue;

      let xml: string;
      if (source.gzipped) {
        const buffer = Buffer.from(await res.arrayBuffer());
        xml = gunzipSync(buffer).toString("utf-8");
      } else {
        xml = await res.text();
      }

      // Parse channels
      const channelRegex = /<channel id="([^"]+)"[\s\S]*?<display-name[^>]*>([^<]+)<\/display-name>/g;
      let match;
      while ((match = channelRegex.exec(xml)) !== null) {
        const norm = normalizeEpgId(match[1]);
        if (!seenNormalized.has(norm)) {
          seenNormalized.add(norm);
          channels.push({ id: match[1], displayName: match[2], normalized: norm });
        }
      }

      // Parse programmes - use non-greedy match up to </programme>
      const progRegex = /<programme\s+start="([^"]+)"\s+stop="([^"]+)"\s+channel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g;
      const titleRegex = /<title[^>]*>([^<]*)<\/title>/;
      const descRegex = /<desc[^>]*>([^<]*)<\/desc>/;
      while ((match = progRegex.exec(xml)) !== null) {
        const channelId = match[3];
        const inner = match[4];
        const titleMatch = titleRegex.exec(inner);
        const descMatch = descRegex.exec(inner);
        const prog: EpgProgramme = {
          start: match[1],
          stop: match[2],
          channel: channelId,
          title: titleMatch?.[1] || "",
          description: descMatch?.[1] || "",
        };
        if (!programmes.has(channelId)) {
          programmes.set(channelId, []);
        }
        programmes.get(channelId)!.push(prog);
      }

      console.log(`[EPG] Loaded from ${source.url}: ${channels.length} channels, ${programmes.size} with programmes`);
    } catch (err) {
      console.error(`[EPG] Failed to fetch ${source.url}: ${err}`);
    }
  }

  console.log(`[EPG] Total: ${channels.length} channels, ${programmes.size} with programme data`);
  epgData = { channels, programmes };
  epgFetchedAt = Date.now();
  return epgData;
}

export async function matchEpgId(streamName: string, existingEpgId: string): Promise<string> {
  if (existingEpgId && existingEpgId.trim() !== "") {
    return existingEpgId;
  }

  const { channels } = await fetchEpgData();
  const normalizedName = normalizeForMatch(streamName);

  if (!normalizedName) return existingEpgId;

  for (const ch of channels) {
    if (ch.normalized === normalizedName) return ch.id;
  }

  let bestMatch: EpgChannel | null = null;
  let bestLen = 0;
  for (const ch of channels) {
    if (ch.normalized.length < 4) continue;
    if (normalizedName.includes(ch.normalized) || ch.normalized.includes(normalizedName)) {
      if (ch.normalized.length > bestLen) {
        bestMatch = ch;
        bestLen = ch.normalized.length;
      }
    }
  }

  if (bestMatch) return bestMatch.id;
  return existingEpgId;
}

export async function enrichStreamsWithEpg(
  streams: { name: string; epg_channel_id: string }[]
): Promise<void> {
  await fetchEpgData();
  for (const stream of streams) {
    stream.epg_channel_id = await matchEpgId(stream.name, stream.epg_channel_id);
  }
}

// Get EPG listings for a specific EPG channel ID (for get_short_epg)
export async function getEpgListings(epgChannelId: string): Promise<object[]> {
  const { programmes } = await fetchEpgData();
  const progs = programmes.get(epgChannelId);
  if (!progs || progs.length === 0) return [];

  const now = Math.floor(Date.now() / 1000);

  // Return programmes around current time (past 2h to future 12h)
  return progs
    .filter((p) => {
      const start = xmltvTimeToEpoch(p.start);
      const stop = xmltvTimeToEpoch(p.stop);
      return stop > now - 7200 && start < now + 43200;
    })
    .map((p) => ({
      id: "",
      epg_id: epgChannelId,
      title: Buffer.from(p.title).toString("base64"),
      lang: "es",
      start: xmltvTimeToEpoch(p.start).toString(),
      end: xmltvTimeToEpoch(p.stop).toString(),
      description: Buffer.from(p.description).toString("base64"),
      channel_id: epgChannelId,
      start_timestamp: xmltvTimeToEpoch(p.start).toString(),
      stop_timestamp: xmltvTimeToEpoch(p.stop).toString(),
      now_playing: xmltvTimeToEpoch(p.start) <= now && xmltvTimeToEpoch(p.stop) > now ? 1 : 0,
      has_archive: 0,
    }));
}
