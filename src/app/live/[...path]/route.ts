import { NextRequest, NextResponse } from "next/server";
import { getProviderByShortCode } from "@/lib/db";

// Redirect stream requests to the actual IPTV provider
// Pattern: /live/shortCode/realPassword/streamId.ts → provider/live/realUser/realPass/streamId.ts
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;

  // path = ["shortCode", "password", "streamId.ts"]
  if (path.length < 3) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [shortCode, password, ...rest] = path;

  const provider = getProviderByShortCode(shortCode);
  if (!provider) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Build the real provider URL using the password from the client
  const streamPath = rest.join("/");
  const providerUrl = provider.url.replace(/\/+$/, "");
  const realUrl = `${providerUrl}/live/${encodeURIComponent(provider.username)}/${encodeURIComponent(password)}/${streamPath}`;

  // Redirect the client directly to the provider
  return NextResponse.redirect(realUrl, 302);
}
