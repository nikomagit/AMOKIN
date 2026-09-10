import { describe, expect, it, vi } from "vitest";
import { LatamTvProxy } from "../src/experimental/latam-tv/proxy.js";

describe("LATAM TV HLS proxy", () => {
  it("rewrites playlists to opaque local URLs and relays segments with headers", async () => {
    const request = vi.fn(async (url: string, init: RequestInit) => {
      const value = new URL(url);
      if (value.pathname === "/live/index.m3u8") {
        return new Response(
          "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin?sig=private\"\n#EXTINF:10,\nsegment.ts?sig=private\n",
          { headers: { "content-type": "application/vnd.apple.mpegurl" } },
        );
      }
      expect(init.headers).toMatchObject({ Referer: "https://video.example/player" });
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "video/mp2t" },
      });
    });
    const proxy = new LatamTvProxy({
      trustedHostSuffixes: ["video.example"],
      timeoutMs: 1_000,
    }, request);
    const playlistUrl = proxy.registerPlaylist(
      "https://video.example/live/index.m3u8?sig=private",
      { Referer: "https://video.example/player" },
      "https://amokin.example",
    );
    expect(playlistUrl).not.toContain("private");

    const playlistToken = playlistUrl.split("/").at(-1)!;
    const playlist = await proxy.getPlaylist(playlistToken, "https://amokin.example");
    expect(playlist?.body).not.toContain("video.example");
    expect(playlist?.body).not.toContain("private");
    expect(playlist?.body).toContain("https://amokin.example/latam-tv/proxy/resource/");

    const segmentUrl = playlist?.body.split("\n").find((line) => line.endsWith(".ts"));
    const resource = await proxy.getResource(segmentUrl!.split("/").at(-1)!, "bytes=0-2");
    expect(resource?.status).toBe(200);
    expect(new Uint8Array(await resource!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(request).toHaveBeenLastCalledWith(
      expect.stringContaining("segment.ts?sig=private"),
      expect.objectContaining({ headers: expect.objectContaining({ Range: "bytes=0-2" }) }),
    );
  });

  it("rejects proxy targets outside the configured player hosts", () => {
    const proxy = new LatamTvProxy({
      trustedHostSuffixes: ["video.example"],
      timeoutMs: 1_000,
    });
    expect(() => proxy.registerPlaylist(
      "http://127.0.0.1/private.m3u8",
      {},
      "https://amokin.example",
    )).toThrow(/Untrusted/);
  });
});
