import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("metadata configuration", () => {
  it("starts with public metadata defaults and no embedded credential", () => {
    const config = loadConfig({});
    expect(config.metadataFallbackBaseUrl).toMatch(/^https:\/\//);
    expect(config.jkAnimeBaseUrl).toBe("https://jkanime.net");
    expect(config.animeMappingBaseUrl).toBe("https://animeapi.my.id");
    expect(config.anilistBaseUrl).toBe("https://graphql.anilist.co");
    expect(config).not.toHaveProperty("tmdbApiKey");
    expect(config.tmdbLanguage).toBe("es-ES");
    expect(config.sportsTvBaseUrl).toBe("https://futbollibrefullhd.org");
    expect(config.sportsTvPlayerHostSuffixes).toEqual([
      "tvf90.com",
      "ftlly.com",
    ]);
    expect(config.externalStreamAddons).toEqual([]);
  });

  it("accepts a TMDB API key only through the runtime environment", () => {
    const config = loadConfig({ TMDB_API_KEY: "private-test-key", TMDB_LANGUAGE: "es-CL" });
    expect(config.tmdbApiKey).toBe("private-test-key");
    expect(config.tmdbLanguage).toBe("es-CL");
  });

  it("does not reactivate the retired TV source from old deployment variables", () => {
    const config = loadConfig({
      LATAM_TV_CATALOG_URL: "https://retired.example",
      LATAM_TV_PLAYER_HOST_SUFFIXES: "retired.example",
    });
    expect(config.sportsTvBaseUrl).toBe("https://futbollibrefullhd.org");
    expect(config.sportsTvPlayerHostSuffixes).toEqual(["tvf90.com", "ftlly.com"]);
  });

  it("loads external stream manifests from private runtime settings", () => {
    const config = loadConfig({
      LATINOBRID_PM_MANIFEST_URL: "https://premium.example/private/manifest.json",
      LATINOBRID_TB_MANIFEST_URL: "https://torbox.example/private/manifest.json",
      NUBE_PLUS_MANIFEST_URL: "https://plus.example/private/manifest.json",
      NOTORRENT_MANIFEST_URL: "https://direct.example/manifest.json?token=private",
    });
    expect(config.externalStreamAddons).toEqual([
      {
        name: "Latinobrid PM",
        manifestUrl: "https://premium.example/private/manifest.json",
        idFormat: "imdb",
        position: "before-local",
      },
      {
        name: "Latinobrid TB",
        manifestUrl: "https://torbox.example/private/manifest.json",
        idFormat: "imdb",
        position: "before-local",
      },
      {
        name: "Nube+",
        manifestUrl: "https://plus.example/private/manifest.json",
        idFormat: "imdb",
        position: "before-local",
      },
      {
        name: "NoTorrent",
        manifestUrl: "https://direct.example/manifest.json?token=private",
        idFormat: "imdb-or-tmdb-underscore",
        position: "last",
      },
    ]);
  });
});
