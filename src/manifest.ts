import { catalogDefinitions } from "./catalogs.js";

export const manifest = Object.freeze({
  id: "org.nuvio.amokin",
  version: "2.2.0",
  name: "AMOKIN",
  logo: "https://amokin.onrender.com/logo.jpg",
  description:
    "Streams HTTP/HTTPS de AMOKIN y fuentes externas configuradas, sin importar sus catalogos y sin P2P.",
  catalogs: catalogDefinitions.map((catalog) => ({
    type: "series",
    id: catalog.id,
    name: catalog.name,
    extra: [{ name: "skip", isRequired: false }],
  })),
  resources: [
    {
      name: "catalog",
      types: ["series"],
    },
    {
      name: "meta",
      types: ["movie", "series"],
      idPrefixes: ["amokin:"],
    },
    {
      name: "stream",
      types: ["movie", "series"],
      idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:"],
    },
  ],
  types: ["movie", "series"],
  idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: true,
    p2p: false,
  },
});
