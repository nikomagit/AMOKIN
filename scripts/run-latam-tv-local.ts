import { buildLocalLatamTvApp } from "../src/experimental/latam-tv/local-app.js";

const port = Number(process.env.LATAM_TV_PORT ?? "7101");
const catalogUrl = process.env.LATAM_TV_CATALOG_URL?.trim() || "https://embed.saohgdassregions.com/";
const suffixes = (process.env.LATAM_TV_PLAYER_HOST_SUFFIXES ?? "saohgdassregions.com,ksdjugfssddeports.com")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const userAgent = process.env.PLAYBACK_USER_AGENT?.trim()
  || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("LATAM_TV_PORT must be a valid port");

const app = buildLocalLatamTvApp({
  catalogUrl,
  trustedPlayerHostSuffixes: suffixes,
  timeoutMs: 15_000,
  maxResponseBytes: 5 * 1024 * 1024,
  userAgent,
  maxStreams: 4,
});

await app.listen({ host: process.env.HOST?.trim() || "127.0.0.1", port });
console.log(`LATAM TV local addon listening on http://127.0.0.1:${port}/manifest.json`);
