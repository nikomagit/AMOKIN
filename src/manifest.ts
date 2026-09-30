import { catalogDefinitions } from "./catalogs.js";
import { LATAM_TV_CATALOG_ID, LATAM_TV_GENRES } from "./experimental/latam-tv/client.js";

export const manifest = Object.freeze({
  id: "org.nuvio.amokin",
  version: "2.3.1",
  name: "AMOKIN",
  logo: "https://amokin.onrender.com/logo.jpg",
  description:
    "Contenido en Latino y sin torrents para Nuvio/Stremio, creado por y para NIKOMA.",
  catalogs: [
    ...catalogDefinitions.map((catalog) => ({
      type: "series",
      id: catalog.id,
      name: catalog.name,
      extra: [{ name: "skip", isRequired: false }],
    })),
    {
      type: "tv",
      id: LATAM_TV_CATALOG_ID,
      name: "LATAM TV • En vivo",
      extra: [{ name: "genre", isRequired: false, options: [...LATAM_TV_GENRES] }],
    },
  ],
  resources: [
    {
      name: "catalog",
      types: ["series", "tv"],
    },
    {
      name: "meta",
      types: ["movie", "series", "tv"],
      idPrefixes: ["amokin:", "latam-tv:"],
    },
    {
      name: "stream",
      types: ["movie", "series", "tv"],
      idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:", "latam-tv:"],
    },
  ],
  types: ["movie", "series", "tv"],
  idPrefixes: ["tt", "tmdb:", "tvdb:", "kitsu:", "anilist:", "mal:", "anidb:", "amokin:", "latam-tv:"],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    adult: true,
    p2p: false,
  },
});
