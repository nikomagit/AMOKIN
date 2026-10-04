import { buildLocalLatamTvApp } from "../src/experimental/latam-tv/local-app.js";
import { loadConfig } from "../src/config.js";

const config = loadConfig();
const port = Number(process.env.SPORTS_TV_PORT ?? "7101");
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("SPORTS_TV_PORT must be a valid port");
const app = buildLocalLatamTvApp({
  catalogUrl: config.sportsTvBaseUrl,
  trustedPlayerHostSuffixes: config.sportsTvPlayerHostSuffixes,
  timeoutMs: config.requestTimeoutMs,
  maxResponseBytes: config.maxResponseBytes,
  userAgent: config.playbackUserAgent,
});
await app.listen({ host: "127.0.0.1", port });
console.log(`Sports TV local addon listening on http://127.0.0.1:${port}/manifest.json`);
