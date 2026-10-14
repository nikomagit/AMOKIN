import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { DirectStreamResolverRegistry } from "../src/providers/resolvers.js";
import { testConfig } from "./helpers.js";

describe("direct video resolvers", () => {
  it("resolves verified AnimeAV1 HLS and MP4Upload mirrors", async () => {
    const request: FetchText = vi.fn(async (url) => {
      const host = new URL(url).hostname;
      if (host.includes("mp4upload")) {
        return `player.src({ type: "video/mp4", src: "https://a1.mp4upload.com:183/d/token/video.mp4" });`;
      }
      throw new Error("unexpected resolver request");
    });
    const registry = new DirectStreamResolverRegistry(testConfig({ maxStreams: 8 }), request);
    const result = await registry.resolveAll([
      { server: "HLS", language: "SUB", url: "https://player.zilla-networks.com/play/3304e956727a3cd4c4116a11526a6094" },
      { server: "Mega", language: "SUB", url: "https://mega.nz/embed/not-direct" },
      { server: "MP4Upload", language: "SUB", url: "https://www.mp4upload.com/embed-example.html" },
    ], "https://animeav1.com/media/title/1");

    expect(result.map((item) => [item.server, item.type])).toEqual([
      ["HLS", "hls"],
      ["MP4Upload", "mp4"],
    ]);
    expect(result[0]?.url).toBe("https://player.zilla-networks.com/m3u8/3304e956727a3cd4c4116a11526a6094");
    expect(result[0]?.headers).toMatchObject({
      Referer: "https://player.zilla-networks.com/play/3304e956727a3cd4c4116a11526a6094",
      Origin: "https://player.zilla-networks.com",
    });
  });

  it("rejects media URLs injected from an unexpected host", async () => {
    const request: FetchText = vi.fn().mockResolvedValue(`file: "https://evil.example/video.mp4"`);
    const registry = new DirectStreamResolverRegistry(testConfig(), request);
    await expect(registry.resolveAll([
      { server: "MP4Upload", language: "SUB", url: "https://www.mp4upload.com/embed-example.html" },
    ], "https://animeav1.com/media/title/1")).resolves.toEqual([]);
  });

  it("resolves and deduplicates JKAnime public UM/UMV HLS players", async () => {
    const request: FetchText = vi.fn().mockResolvedValue(`
      video: { url: 'https://nika.playmudos.com/media/title/master.m3u8?token=public', type: 'customHls' }
    `);
    const registry = new DirectStreamResolverRegistry(testConfig({ maxStreams: 8 }), request);
    const result = await registry.resolveAll([
      { server: "JKAnime UM", language: "SUB-ES", url: "https://jkanime.net/jkplayer/um/?u=one" },
      { server: "JKAnime UMV", language: "SUB-ES", url: "https://jkanime.net/jkplayer/umv/?u=two" },
      { server: "JKAnime UM", language: "SUB-ES", url: "https://evil.example/jkplayer/um/?u=blocked" },
    ], "https://jkanime.net/haikyuu-third-season/1/");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      server: "JKAnime UM",
      language: "SUB-ES",
      type: "hls",
      url: "https://nika.playmudos.com/media/title/master.m3u8?token=public",
    });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
