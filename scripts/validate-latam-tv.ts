import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  LATAM_TV_GENRES,
  LatamTvClient,
  latamTvChannelSlug,
} from "../src/experimental/latam-tv/client.js";
import { fetchText } from "../src/lib/http.js";

const catalogUrl = process.env.LATAM_TV_CATALOG_URL?.trim() || "https://embed.saohgdassregions.com/";
const userAgent = process.env.PLAYBACK_USER_AGENT?.trim()
  || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const client = new LatamTvClient({
  catalogUrl,
  trustedPlayerHostSuffixes: (process.env.LATAM_TV_PLAYER_HOST_SUFFIXES ?? "saohgdassregions.com,ksdjugfssddeports.com").split(","),
  timeoutMs: 15_000,
  maxResponseBytes: 5 * 1024 * 1024,
  userAgent,
  maxStreams: 4,
}, fetchText);

const channels = await client.getChannels();
if (channels.length === 0) throw new Error("Catalog returned no channels");
const genreCounts = Object.fromEntries(
  LATAM_TV_GENRES.map((genre) => [genre, channels.filter((channel) => channel.genre === genre).length]),
);
if (Object.values(genreCounts).some((count) => count === 0)) {
  throw new Error("Catalog did not return channels for both genres");
}
await Promise.all(channels.map(async (candidate) => {
  const slug = latamTvChannelSlug(candidate.id);
  if (!slug) throw new Error(`Invalid channel id ${candidate.id}`);
  const poster = await readFile(resolve(process.cwd(), "assets", "latam-tv", "posters", `${slug}.png`));
  if (!poster.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error(`Invalid PNG poster for ${candidate.id}`);
  }
}));
const requested = process.env.LATAM_TV_CHANNEL?.trim().toLocaleLowerCase("en");
const channel = channels.find((candidate) => candidate.id === requested || candidate.name.toLocaleLowerCase("en") === requested)
  ?? channels[0];
if (!channel) throw new Error("No channel selected");
const streams = await client.resolve(channel);
if (streams.length === 0) throw new Error(`No playback options resolved for ${channel.name}`);

const checks = await Promise.all(streams.map(async (stream) => {
  const playlist = await fetchText(stream.url, {
    timeoutMs: 15_000,
    maxBytes: 512 * 1024,
    upstream: stream.name,
    headers: stream.headers,
  });
  const streamUrl = new URL(stream.url);
  return {
    option: stream.name,
    endpoint: `${streamUrl.origin}${streamUrl.pathname}`,
    validHls: playlist.startsWith("#EXTM3U"),
  };
}));
if (checks.some((check) => !check.validHls)) throw new Error("A resolved option did not return an HLS playlist");
console.log(JSON.stringify({
  channels: channels.length,
  genres: genreCounts,
  posters: channels.length,
  channel: channel.name,
  checks,
}, null, 2));
