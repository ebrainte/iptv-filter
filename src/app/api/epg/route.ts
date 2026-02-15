import { NextRequest, NextResponse } from "next/server";
import { gunzipSync } from "zlib";
import { EPG_SOURCES } from "@/lib/epg";

// Cache the merged EPG XML (refresh every 6 hours)
let cachedXml: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function getMergedEpg(): Promise<string> {
  if (cachedXml && Date.now() - cachedAt < CACHE_TTL) {
    return cachedXml;
  }

  const allChannels: string[] = [];
  const allProgrammes: string[] = [];

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

      // Extract channel and programme elements
      const channelMatches = xml.match(/<channel[\s\S]*?<\/channel>/g);
      const programmeMatches = xml.match(/<programme[\s\S]*?<\/programme>/g);

      if (channelMatches) allChannels.push(...channelMatches);
      if (programmeMatches) allProgrammes.push(...programmeMatches);
    } catch (err) {
      console.error(`[EPG API] Failed to fetch ${source.url}: ${err}`);
    }
  }

  console.log(`[EPG API] Merged ${allChannels.length} channels, ${allProgrammes.length} programmes`);

  const merged = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="iptv-editor">
${allChannels.join("\n")}
${allProgrammes.join("\n")}
</tv>`;

  cachedXml = merged;
  cachedAt = Date.now();
  return merged;
}

export async function GET(_request: NextRequest) {
  try {
    const xml = await getMergedEpg();

    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml",
        "Content-Disposition": 'inline; filename="xmltv.xml"',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(`<?xml version="1.0"?><tv></tv>`, {
      status: 200,
      headers: { "Content-Type": "application/xml" },
    });
  }
}
