import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const app = await buildApp(loadConfig({ ...process.env, LOG_LEVEL: "silent" }));
const report: Array<Record<string, unknown>> = [];
let failed = false;
try {
  const catalog = (await app.inject("/catalog/tv/latam-tv.json")).json().metas;
  if (catalog.length !== 5) throw new Error("Expected exactly five sports channels");
  for (const channel of catalog) {
    const start = Date.now();
    try {
      const poster = await app.inject(new URL(channel.poster).pathname);
      if (poster.statusCode !== 200) throw new Error("Missing poster");
      const meta = (await app.inject(`/meta/tv/${channel.id}.json`)).json().meta;
      if (meta?.name !== channel.name) throw new Error("Incorrect metadata");
      const streams = (await app.inject(`/stream/tv/${channel.id}.json`)).json().streams;
      if (!streams?.length) throw new Error("No HLS stream resolved");
      const playlist = await app.inject(new URL(streams[0].url).pathname);
      if (playlist.statusCode !== 200 || !playlist.body.startsWith("#EXTM3U")) {
        throw new Error(`Invalid playlist (HTTP ${playlist.statusCode})`);
      }
      const segmentUrl = playlist.body.split("\n").find((line) => line.startsWith("http"));
      if (!segmentUrl) throw new Error("Missing HLS segment");
      const segment = await app.inject(new URL(segmentUrl).pathname);
      if (segment.statusCode !== 200 || segment.rawPayload.length < 188) {
        throw new Error(`Invalid segment (HTTP ${segment.statusCode})`);
      }
      report.push({
        channel: channel.name, poster: poster.statusCode, playlist: playlist.statusCode,
        segment: segment.statusCode, bytes: segment.rawPayload.length, elapsedMs: Date.now() - start,
      });
    } catch (error) {
      failed = true;
      report.push({ channel: channel.name, error: error instanceof Error ? error.message : "Failed" });
    }
  }
  console.log(JSON.stringify({ version: (await app.inject("/manifest.json")).json().version, checks: report }, null, 2));
} finally { await app.close(); }
if (failed) process.exitCode = 1;
