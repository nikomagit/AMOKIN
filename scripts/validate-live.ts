import { loadConfig } from "../src/config.js";
import { RemoteMetadataProvider } from "../src/metadata/client.js";
import { parseMediaId } from "../src/metadata/media-id.js";
import { AnimeAv1Client } from "../src/providers/animeav1/client.js";
import { JkAnimeClient } from "../src/providers/jkanime/client.js";
import { DirectStreamResolverRegistry } from "../src/providers/resolvers.js";
import type { DirectMediaProvider } from "../src/providers/types.js";
import { ProviderSearchService } from "../src/services/search.js";
import type { AddonStream, MediaType } from "../src/types.js";

interface CheckTarget {
  label: string;
  type: MediaType;
  id: string;
  providers: string[];
}

const config = loadConfig({
  ...process.env,
  LOG_LEVEL: "silent",
  REQUEST_TIMEOUT_MS: "15000",
  METADATA_TIMEOUT_MS: "12000",
  MAX_STREAMS: "8",
});
const resolver = new DirectStreamResolverRegistry(config);
const metadata = new RemoteMetadataProvider(config);
const providers: DirectMediaProvider[] = [
  new AnimeAv1Client(config),
  new JkAnimeClient(config),
];

const targets: CheckTarget[] = [
  { label: "IMDb • One Piece E1", type: "series", id: "tt0388629:1:1", providers: ["animeav1"] },
  { label: "TMDB • One Piece E1", type: "series", id: "tmdb:37854:1:1", providers: ["jkanime"] },
  { label: "TVDB • One Piece E1", type: "series", id: "tvdb:81797:1:1", providers: ["animeav1"] },
  { label: "Kitsu • One Piece E1", type: "series", id: "kitsu:12:1", providers: ["animeav1"] },
  { label: "AniList • One Piece E1", type: "series", id: "anilist:21:1", providers: ["jkanime"] },
  { label: "MAL • One Piece E1", type: "series", id: "mal:21:1", providers: ["animeav1"] },
  { label: "AniDB • One Piece E1", type: "series", id: "anidb:69:1", providers: ["jkanime"] },
  { label: "IMDb season map • Haikyuu T3E1", type: "series", id: "tt3398540:3:1", providers: ["animeav1"] },
  { label: "TMDB season map • Haikyuu T3E1", type: "series", id: "tmdb:60863:3:1", providers: ["jkanime"] },
];

function serverName(stream: AddonStream): string {
  return stream.name.split("•").at(-1)?.trim() || "unknown";
}

async function validateStream(stream: AddonStream) {
  const headers = new Headers(stream.behaviorHints.proxyHeaders?.request ?? {});
  if (stream.type === "mp4") headers.set("range", "bytes=0-2047");
  const response = await fetch(stream.url, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  let playlist = false;
  if (stream.type === "hls" && response.ok) {
    playlist = (await response.text()).trimStart().startsWith("#EXTM3U");
  } else if (response.body) {
    await response.body.cancel();
  }
  return {
    server: serverName(stream),
    type: stream.type,
    status: response.status,
    contentType,
    finalHost: new URL(response.url).hostname,
    playable: response.ok && (stream.type !== "hls" || playlist),
  };
}

const results = [];
for (const target of targets) {
  const selected = providers.filter((provider) => target.providers.includes(provider.id));
  try {
    const parsed = parseMediaId(target.type, target.id);
    const resolvedMetadata = await metadata.resolve(target.type, parsed);
    const service = new ProviderSearchService(
      config,
      { resolve: async () => resolvedMetadata },
      selected.map((provider) => ({ provider, resolvers: resolver })),
    );
    const streams = await service.getStreams(target.type, target.id);
    const checks = [];
    for (const stream of streams.slice(0, 1)) {
      try {
        checks.push(await validateStream(stream));
      } catch (error) {
        checks.push({
          server: serverName(stream), type: stream.type, status: 0, contentType: "",
          finalHost: "", playable: false,
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    }
    results.push({
      target: target.label,
      providers: target.providers,
      metadata: {
        title: resolvedMetadata.title,
        aliases: resolvedMetadata.aliases,
        seasonAliases: resolvedMetadata.seasonAliases ?? [],
        externalIds: resolvedMetadata.externalIds,
        seasonYear: resolvedMetadata.seasonYear,
        seasonEpisodeCount: resolvedMetadata.seasonEpisodeCount,
      },
      streams: streams.length,
      matchedTitles: streams.map((stream) => stream.title.split("\n")[0]),
      checks,
    });
  } catch (error) {
    results.push({
      target: target.label,
      providers: target.providers,
      streams: 0,
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
