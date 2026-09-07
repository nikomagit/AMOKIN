# AMOKIN para Nuvio/Stremio

AMOKIN resuelve reproducción HTTP/HTTPS directa desde [AnimeAV1](https://animeav1.com/), [Hentaila](https://hentaila.com/) y [JKAnime](https://jkanime.net/), y también combina respuestas de addons externos configurables. Los catálogos y metadatos de esos addons externos no se importan.

Latinobrid se integra como un agregador externo de resultados en español latino, con un funcionamiento comparable a Comet o Torrentio y respaldado por las cuentas PM/TB configuradas; no se considera un proveedor HTTP propio de AMOKIN. Al cliente solo se reenvían entradas con una URL HTTP/HTTPS reproducible. Se filtran torrents sin resolver, magnet links, `infoHash`, trackers y enlaces promocionales; el manifest declara `p2p: false`.

> Los sitios y hosts de vídeo son servicios de terceros. Usa el proyecto solo donde el contenido y el acceso estén permitidos, respetando sus términos y la legislación aplicable. AMOKIN no evita autenticación, CAPTCHA, DRM, protecciones anti-bot ni restricciones de acceso.

## Instalación pública

Agrega este manifest en Nuvio o Stremio:

```text
https://amokin.onrender.com/manifest.json
```

La versión pública actual se despliega automáticamente desde la rama `main` en Render.

## Funciones

- Endpoints estándar `catalog`, `meta` y `stream` del protocolo Stremio.
- Streams directos HLS/MP4 con headers de reproducción cuando son necesarios.
- Entradas externas IMDb, TMDB, TVDB (series), Kitsu, AniList, MyAnimeList (MAL) y AniDB.
- Conversión a una identidad común con IMDb, TMDB, Kitsu, AniList, MAL, AniDB y TVDB cuando el mapa dispone de ellos.
- Títulos original, inglés, japonés, romaji y sinónimos mediante AniList.
- Matching por identidad externa cuando el proveedor la expone; alias, año, tipo, temporada y episodio como fallback conservador.
- Resolución de temporadas que el proveedor publica como fichas independientes.
- Agregación opcional de los streams de Latinobrid PM, Latinobrid TB y NoTorrent, sin importar sus catálogos.
- Orden de streams: Latinobrid PM/TB, contenido propio de AMOKIN y, al final, NoTorrent.
- Deduplicación por URL final, cachés TTL, timeouts y aislamiento de errores por proveedor/resolver.
- Tres catálogos Hentaila: populares, al aire y sin censura.

AnimeAV1 y Hentaila comparten un cliente para los datos públicos SvelteKit. JKAnime usa su búsqueda y páginas públicas. Ninguno de los tres publica actualmente IMDb/TMDB/Kitsu/MAL/AniList en sus fichas, por lo que los IDs se convierten primero en metadatos y alias; la similitud textual se usa al final, no como identidad primaria.

## IDs admitidos

```text
/stream/movie/tt1234567.json
/stream/series/tt0388629:1:1.json
/stream/movie/tmdb:12345.json
/stream/series/tmdb:37854:1:1.json
/stream/series/tvdb:81797:1:1.json
/stream/series/kitsu:12:1.json
/stream/series/anilist:21:1.json
/stream/series/mal:21:1.json
/stream/series/anidb:69:1.json
/stream/series/amokin:animeav1:one-piece:1.json
/stream/series/amokin:hentaila:slug:1.json
/stream/series/amokin:jkanime:one-piece:1.json
```

IMDb, TMDB y TVDB usan `temporada:episodio`. Kitsu, AniList, MAL y AniDB aceptan `id:episodio`, porque normalmente cada registro de esas bases representa una temporada/cour; también se acepta explícitamente `id:temporada:episodio`. Los IDs `amokin:` provienen de los catálogos y no necesitan metadatos externos.

## Estrategia de metadatos

1. Se detecta el prefijo del ID.
2. IMDb se consulta en Cinemeta. Si existe `TMDB_API_KEY`, los IDs TMDB usan primero la API oficial; sin ella se intenta el addon público compatible con Stremio. Kitsu usa su API pública y AniList/MAL usan AniList GraphQL.
3. [AnimeAPI](https://github.com/nattadasu/animeApi/tree/v3) relaciona IMDb/TMDB/TVDB/Kitsu/AniList/MAL/AniDB. Para temporadas TMDB o TVDB se usa el endpoint específico antes del mapa general.
4. AniList aporta títulos romaji, inglés, japonés y sinónimos de la entrada mapeada.
5. Si AnimeAPI no responde, IMDb/TMDB/Kitsu/AniList/MAL conservan su metadata base y el addon sigue usando alias. TVDB y AniDB requieren el mapa para poder obtener un título.
6. Una `TMDB_API_KEY` privada es necesaria para que todos los IDs TMDB funcionen de forma fiable cuando el mapa comunitario no contiene una equivalencia o el addon público no está disponible.

AnimeAPI agrega datos mantenidos por terceros y tiene limitaciones conocidas en relaciones muchos-a-muchos, cours, especiales y algunas temporadas. Por ello AMOKIN no considera que una conversión sea infalible: valida año, tipo, temporada, cantidad de episodios y aliases antes de elegir una ficha.

## Endpoints

```text
GET /health
GET /manifest.json
GET /catalog/series/{catalogId}.json
GET /catalog/series/{catalogId}/skip=20.json
GET /meta/{type}/amokin:{provider}:{slug}.json
GET /stream/{type}/{id}.json
```

Catálogos:

- `hentaila-popular`
- `hentaila-airing`
- `hentaila-uncensored`

## Ejecución local

Requisitos: Node.js 20 o superior y npm.

```bash
npm install
npm run build
npm start
```

El servidor queda en `http://127.0.0.1:7100`; para desarrollo usa `npm run dev`. Instala localmente `http://127.0.0.1:7100/manifest.json`.

## Configuración

La configuración predeterminada funciona con IDs nativos y las bases públicas disponibles. Para compatibilidad fiable con todos los IDs TMDB, configura `TMDB_API_KEY`. Copia `.env.example` como `.env` solo para modificarla. Las URLs de manifests externos pueden contener credenciales: guárdalas como variables privadas del entorno y nunca las publiques en Git.

| Variable | Predeterminado | Uso |
|---|---|---|
| `HOST` | `0.0.0.0` | Interfaz de escucha. |
| `PORT` | `7100` | Puerto HTTP. |
| `ANIMEAV1_BASE_URL` | `https://animeav1.com` | Origen de AnimeAV1. |
| `ANIMEAV1_CDN_BASE_URL` | `https://cdn.animeav1.com` | Imágenes de AnimeAV1. |
| `HENTAILA_BASE_URL` | `https://hentaila.com` | Origen de Hentaila. |
| `HENTAILA_CDN_BASE_URL` | `https://cdn.hentaila.com` | Imágenes de Hentaila. |
| `JKANIME_BASE_URL` | `https://jkanime.net` | Origen de JKAnime. |
| `ANIME_MAPPING_BASE_URL` | `https://animeapi.my.id` | Mapa opcional entre IDs de anime. |
| `ANILIST_BASE_URL` | `https://graphql.anilist.co` | GraphQL de metadatos y aliases. |
| `METADATA_BASE_URL` | `https://v3-cinemeta.strem.io` | Metadatos IMDb. |
| `METADATA_FALLBACK_BASE_URL` | addon TMDB público | Metadatos TMDB sin clave. |
| `TMDB_API_KEY` | vacío | Metadatos oficiales y aliases TMDB; recomendada en producción y siempre privada. |
| `TMDB_LANGUAGE` | `es-ES` | Idioma solicitado a TMDB. |
| `LATINOBRID_PM_MANIFEST_URL` | vacío | Manifest privado de Latinobrid PM; solo se consulta su recurso `stream`. |
| `LATINOBRID_TB_MANIFEST_URL` | vacío | Manifest privado de Latinobrid TB; solo se consulta su recurso `stream`. |
| `NOTORRENT_MANIFEST_URL` | vacío | Manifest privado de NoTorrent; conserva su token en las consultas de streams. |
| `REQUEST_TIMEOUT_MS` | `10000` | Timeout de proveedores/hosts. |
| `METADATA_TIMEOUT_MS` | `6000` | Timeout de metadatos/mapas. |
| `MAX_STREAMS` | `8` | Máximo de streams propios por resolución; los externos válidos se agregan después. |
| `MIN_MATCH_SCORE` | `0.72` | Umbral conservador de matching. |

## Docker y despliegue

```bash
docker compose up -d --build
```

O:

```bash
docker build -t amokin .
docker run --rm -p 7100:7100 -e PORT=7100 amokin
```

Consulta [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). GitHub Pages no sirve porque el addon necesita un proceso Node.js activo para consultar proveedores y resolver URLs temporales.

## Arquitectura

```text
Nuvio / Stremio
  ├─ /catalog → Hentaila → metas con ID amokin
  ├─ /meta    → ID amokin → ficha y episodios
  └─ /stream
       ├─ ID amokin → proveedor conocido
       └─ ID externo
            ├─ metadata + mapa de IDs + aliases AniList
            │    → AnimeAV1 / Hentaila / JKAnime
            │    → matching → episodio → resolver HTTP
            └─ manifests externos configurados → solo /stream
                 → filtro HTTP/HTTPS → deduplicación
```

- `src/metadata/`: parser, consultores y mapa de IDs.
- `src/providers/svelte/`: cliente compartido AnimeAV1/Hentaila.
- `src/providers/animeav1/`, `hentaila/`, `jkanime/`: proveedores de anime.
- `src/providers/resolvers.ts`: HLS/MP4 directos permitidos.
- `src/services/`: catálogos, fichas, matching y búsqueda.
- `scripts/validate-live.ts`: validación real de IDs, temporadas y streams.

AMOKIN no almacena ni retransmite vídeo. Resuelve la URL al solicitar `/stream` y el reproductor accede al host final con los headers declarados.

## Verificación

```bash
npm run typecheck
npm test
npm run build
npm run validate:live
```

Los tests cubren todos los formatos de ID, conversiones, aliases japonés/inglés/romaji, identidad externa, conflictos, temporadas separadas, episodios, resolvers, deduplicación, aislamiento y endpoints HTTP. La investigación detallada está en [docs/RESEARCH.md](docs/RESEARCH.md).

## Referencias

- [NuvioMobile](https://github.com/NuvioMedia/NuvioMobile)
- [Protocolo de addons de Stremio](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [AIO Metadata](https://github.com/cedya77/aiometadata/tree/dev)
- [AnimeAPI](https://github.com/nattadasu/animeApi/tree/v3)
- [Fribb anime-lists](https://github.com/Fribb/anime-lists)
- [AniList API](https://docs.anilist.co/)

## Licencia

MIT. El proyecto no está afiliado con Nuvio, Stremio, los proveedores, los servicios de metadata ni los hosts de vídeo.
