export interface XtreamCredentials {
  url: string;
  username: string;
  password: string;
}

export interface AccountInfo {
  username: string;
  status: string;
  exp_date: string;
  active_cons: string;
  max_connections: string;
}

export interface Category {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface Stream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string;
  added: string;
  category_id: string;
  custom_sid: string;
  tv_archive: number;
  direct_source: string;
  tv_archive_duration: number;
}

function baseUrl(creds: XtreamCredentials): string {
  let url = creds.url.trim().replace(/\/+$/, "");
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "http://" + url;
  }
  return url;
}

function apiUrl(creds: XtreamCredentials): string {
  return `${baseUrl(creds)}/player_api.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
}

export async function getAccountInfo(creds: XtreamCredentials): Promise<AccountInfo> {
  const res = await fetch(apiUrl(creds));
  if (!res.ok) throw new Error(`Failed to connect: ${res.status}`);
  const data = await res.json();
  if (data.user_info?.auth === 0) throw new Error("Authentication failed");
  return data.user_info;
}

export async function getLiveCategories(creds: XtreamCredentials): Promise<Category[]> {
  const res = await fetch(`${apiUrl(creds)}&action=get_live_categories`);
  if (!res.ok) throw new Error(`Failed to fetch categories: ${res.status}`);
  return res.json();
}

export async function getLiveStreams(creds: XtreamCredentials): Promise<Stream[]> {
  const res = await fetch(`${apiUrl(creds)}&action=get_live_streams`);
  if (!res.ok) throw new Error(`Failed to fetch streams: ${res.status}`);
  return res.json();
}

export async function getLiveStreamsByIds(
  creds: XtreamCredentials,
  selectedIds: Set<number>
): Promise<Stream[]> {
  const allStreams = await getLiveStreams(creds);
  return allStreams.filter((s) => selectedIds.has(s.stream_id));
}

export function buildM3U(
  creds: XtreamCredentials,
  streams: Stream[],
  categories: Category[]
): string {
  const catMap = new Map<string, string>();
  for (const cat of categories) {
    catMap.set(cat.category_id, cat.category_name);
  }

  const base = baseUrl(creds);
  const lines: string[] = ['#EXTM3U url-tvg="https://epgshare01.online/epgshare01/epg_ripper_AR1.xml.gz,https://raw.githubusercontent.com/globetvapp/epg/main/Argentina/argentina1.xml"'];

  for (const stream of streams) {
    const groupTitle = catMap.get(stream.category_id) || "Uncategorized";
    const tvgId = stream.epg_channel_id || "";
    const tvgLogo = stream.stream_icon || "";

    lines.push(
      `#EXTINF:-1 tvg-id="${tvgId}" tvg-name="${stream.name}" tvg-logo="${tvgLogo}" group-title="${groupTitle}",${stream.name}`
    );
    lines.push(
      `${base}/${encodeURIComponent(creds.username)}/${encodeURIComponent(creds.password)}/${stream.stream_id}.ts`
    );
  }

  return lines.join("\n");
}
