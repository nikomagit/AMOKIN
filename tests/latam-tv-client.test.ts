import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { LatamTvClient } from "../src/experimental/latam-tv/client.js";
import { buildLocalLatamTvApp } from "../src/experimental/latam-tv/local-app.js";

const options = {
  catalogUrl: "https://source.example/",
  trustedPlayerHostSuffixes: ["player.example", "cdn.example"],
  timeoutMs: 1_000,
  maxResponseBytes: 100_000,
  userAgent: "AMOKIN test",
};

function fixtureRequest(): FetchText {
  return vi.fn(async (url, requestOptions) => {
    const value = new URL(url);
    if (value.hostname === "source.example") {
      return '<iframe src="https://player.example/online/canal.php?stream=espn2"></iframe>';
    }
    if (value.pathname === "/online/canal.php") {
      expect(requestOptions.headers?.Referer).toBe("https://source.example/en-vivo/espn-2");
      return '<iframe src="/5.php?stream=espn2"></iframe>';
    }
    if (value.pathname === "/5.php") {
      expect(requestOptions.headers?.Referer).toBe("https://player.example/online/canal.php?stream=espn2");
      return 'var playbackURL = "https://11.cdn.example/espn2/mono.m3u8?token=temporary";';
    }
    throw new Error("Unexpected URL");
  });
}

describe("curated sports TV", () => {
  it("contains exactly the five requested channels and needs no catalog scraping", async () => {
    const request = fixtureRequest();
    const client = new LatamTvClient(options, request);
    const channels = await client.getChannels();
    expect(channels.map((channel) => channel.name)).toEqual(["DSport", "DSport+", "ESPN", "ESPN2", "ESPN3"]);
    expect(channels.map((channel) => new URL(channel.sourceUrl).pathname)).toEqual([
      "/en-vivo/directv-sports-online", "/en-vivo/directv-sports-plus-online",
      "/en-vivo/espn-1", "/en-vivo/espn-2", "/en-vivo/espn-3",
    ]);
    expect(channels.every((channel) => channel.genre === "Deportes")).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(await client.getChannel("latam-tv:tnt")).toBeNull();
    expect(await client.resolveChannel("latam-tv:espnar")).toEqual([]);
  });

  it("follows the announced relative iframe and extracts the signed HLS URL", async () => {
    const client = new LatamTvClient(options, fixtureRequest());
    expect(await client.resolveChannel("latam-tv:espn2")).toEqual([
      expect.objectContaining({
        url: "https://11.cdn.example/espn2/mono.m3u8?token=temporary",
        type: "hls",
        headers: expect.objectContaining({
          Origin: "https://player.example",
          Referer: "https://player.example/5.php?stream=espn2",
        }),
      }),
    ]);
  });

  it("does not follow advertising or untrusted iframes", async () => {
    const request: FetchText = vi.fn(async () => '<iframe src="http://127.0.0.1/private"></iframe>');
    const client = new LatamTvClient(options, request);
    expect(await client.resolveChannel("latam-tv:espn2")).toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the local catalog limited to Deportes and removes the old regional metadata", async () => {
    const app = buildLocalLatamTvApp(options, fixtureRequest());
    try {
      const manifest = (await app.inject("/manifest.json")).json();
      expect(manifest.catalogs[0].extra[0].options).toEqual(["Deportes"]);
      expect((await app.inject("/catalog/tv/latam-tv.json")).json().metas).toHaveLength(5);
      expect((await app.inject("/catalog/tv/latam-tv/genre=Regionales.json")).json().metas).toEqual([]);
      expect((await app.inject("/meta/tv/latam-tv:tnt.json")).json().meta).toBeNull();
      expect((await app.inject("/meta/tv/latam-tv:espn2.json")).json().meta).toMatchObject({
        name: "ESPN2", genres: ["Deportes"], poster: expect.stringContaining("/espn2.png"),
      });
    } finally { await app.close(); }
  });
});
