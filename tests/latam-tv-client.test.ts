import { describe, expect, it, vi } from "vitest";
import type { FetchText } from "../src/lib/http.js";
import { LatamTvClient } from "../src/experimental/latam-tv/client.js";
import { buildLocalLatamTvApp } from "../src/experimental/latam-tv/local-app.js";

const catalogUrl = "https://embed.example/";
const catalogHtml = `
  <div class="category active" id="deportes">
    <div class="card"><div class="channel-name">Canal Uno</div><a href="https://embed.example/canal-uno.php">LINK</a></div>
    <div class="card"><div class="channel-name">Canal Uno alternativo</div><a href="https://embed.example/canal-uno.php">LINK</a></div>
    <div class="card"><div class="channel-name">No permitido</div><a href="https://other.example/no.php">LINK</a></div>
  </div>
  <div class="category" id="regionales">
    <div class="card"><div class="channel-name">Canal Dos</div><a href="https://embed.example/canal-dos.php">LINK</a></div>
  </div>
`;

function fixtureRequest(): FetchText {
  return vi.fn(async (url) => {
    const value = new URL(url);
    if (value.href === catalogUrl) return catalogHtml;
    if (value.href === "https://embed.example/canal-uno.php") {
      return `
        <h2>JW PLAYER</h2>
        <input value="&lt;iframe src=&quot;https://embed.example/embed2/canal-uno.php&quot;&gt;&lt;/iframe&gt;">
        <h2>CLAPPR</h2>
        <input value="&lt;iframe src=&quot;https://embed.example/embed/canal-uno.php&quot;&gt;&lt;/iframe&gt;">
      `;
    }
    if (value.href === "https://embed.example/embed2/canal-uno.php") {
      return `<iframe src="https://player.example/stream.php?canal=canal-uno&amp;target=2&amp;sig=fresh"></iframe>`;
    }
    if (value.href === "https://embed.example/embed/canal-uno.php") {
      return `<iframe src="https://player.example/stream.php?canal=canal-uno&amp;target=3&amp;sig=fresh"></iframe>`;
    }
    if (value.hostname === "player.example") {
      return value.searchParams.get("target") === "2"
        ? `file: "https:\/\/player.example\/playlist.php?id=1_&sig=temporary";`
        : `const playbackURL = "https:\/\/player.example\/playlist.php?id=1_&sig=temporary";`;
    }
    throw new Error(`Unexpected URL ${value}`);
  });
}

function options() {
  return {
    catalogUrl,
    trustedPlayerHostSuffixes: ["player.example"],
    timeoutMs: 1_000,
    maxResponseBytes: 100_000,
    userAgent: "AMOKIN test",
  };
}

describe("LATAM TV isolated client", () => {
  it("creates one TV catalog item per channel without resolving it", async () => {
    const request = fixtureRequest();
    const client = new LatamTvClient(options(), request);

    await expect(client.getChannels()).resolves.toEqual([
      {
        id: "latam-tv:canal-uno",
        type: "tv",
        name: "Canal Uno alternativo",
        genre: "Deportes",
        sourceUrl: "https://embed.example/canal-uno.php",
      },
      {
        id: "latam-tv:canal-dos",
        type: "tv",
        name: "Canal Dos",
        genre: "Regionales",
        sourceUrl: "https://embed.example/canal-dos.php",
      },
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("resolves both player choices at selection time and deduplicates the same HLS URL", async () => {
    const request = fixtureRequest();
    const client = new LatamTvClient(options(), request);

    const streams = await client.resolveChannel("latam-tv:canal-uno");
    expect(streams).toEqual([
      expect.objectContaining({
        name: "LATAM TV • JW PLAYER",
        type: "hls",
        url: "https://player.example/playlist.php?id=1_&sig=temporary",
        headers: expect.objectContaining({
          Origin: "https://player.example",
          Referer: "https://player.example/stream.php?canal=canal-uno&target=2&sig=fresh",
          "User-Agent": "AMOKIN test",
        }),
      }),
    ]);
  });

  it("exposes only the isolated TV manifest and endpoints", async () => {
    const app = buildLocalLatamTvApp(options(), fixtureRequest());
    try {
      const manifest = await app.inject({ method: "GET", url: "/manifest.json" });
      expect(manifest.json()).toMatchObject({
        types: ["tv"],
        catalogs: [{
          type: "tv",
          id: "latam-tv",
          extra: [{ name: "genre", options: ["Deportes", "Regionales"] }],
        }],
        resources: expect.arrayContaining([
          expect.objectContaining({ name: "meta", types: ["tv"], idPrefixes: ["latam-tv:"] }),
          expect.objectContaining({ name: "stream", types: ["tv"] }),
        ]),
      });
      const catalog = await app.inject({ method: "GET", url: "/catalog/tv/latam-tv.json" });
      expect(catalog.json().metas).toHaveLength(2);
      expect(catalog.json().metas[0]).toMatchObject({
        id: "latam-tv:canal-uno",
        type: "tv",
        name: "Canal Uno alternativo",
        genres: ["Deportes"],
        poster: expect.stringMatching(/\/latam-tv\/posters\/canal-uno\.png$/),
      });
      const regionales = await app.inject({
        method: "GET",
        url: "/catalog/tv/latam-tv/genre=Regionales.json",
      });
      expect(regionales.json().metas).toEqual([
        expect.objectContaining({ id: "latam-tv:canal-dos", genres: ["Regionales"] }),
      ]);
      const meta = await app.inject({ method: "GET", url: "/meta/tv/latam-tv:canal-uno.json" });
      expect(meta.json()).toEqual({
        meta: expect.objectContaining({
          id: "latam-tv:canal-uno",
          type: "tv",
          name: "Canal Uno alternativo",
          description: "Canal de televisión en vivo · Deportes: Canal Uno alternativo",
          genres: ["Deportes"],
        }),
      });
    } finally {
      await app.close();
    }
  });
});
