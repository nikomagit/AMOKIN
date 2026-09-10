# Despliegue

AMOKIN necesita un servidor Node.js activo. GitHub Pages no es suficiente porque solo publica archivos estáticos.

## Instalación pública actual

Repositorio:

```text
https://github.com/nikomagit/AMOKIN
```

Manifest:

```text
https://amokin.onrender.com/manifest.json
```

El servicio de Render está conectado a la rama `main`; cada actualización inicia un despliegue automático. El plan gratuito puede entrar en reposo y provocar un arranque lento en la primera solicitud.

La TV en vivo pasa por el proxy HLS de AMOKIN porque las firmas del proveedor están vinculadas a la IP de resolución. El consumo de ancho de banda del servicio aumenta mientras haya reproducciones activas.

## Render desde cero

1. Crea un repositorio de GitHub sin `.env`, `node_modules` ni `dist`.
2. En Render selecciona **New > Blueprint** y conecta el repositorio.
3. Render detectará `render.yaml` y construirá el `Dockerfile`.
4. Guarda `TMDB_API_KEY` como secreto del servicio para resolver de forma fiable los IDs TMDB que no estén presentes en el mapa comunitario. Nunca la guardes en Git.
5. Espera a que `/health` responda `{"status":"ok",...}`.
6. Instala `https://TU-SERVICIO.onrender.com/manifest.json` en Nuvio/Stremio.

Los valores predeterminados ya incluyen los orígenes públicos de AnimeAV1, Hentaila y JKAnime. Solo cámbialos si mantienes un mirror compatible autorizado.

## Koyeb

1. Crea un Web Service desde el repositorio de GitHub.
2. Selecciona el `Dockerfile`, tipo **Web**, una instancia gratuita y una región disponible.
3. Expón el puerto `7100` y configura `/health` como health check.
4. Agrega `HOST=0.0.0.0` y `PORT=7100`; no se requieren secretos.
5. Instala `https://TU-SERVICIO.koyeb.app/manifest.json`.

## VPS con Docker Compose

Requisitos: Docker Engine, Compose v2, un dominio y un proxy HTTPS como Caddy o Nginx.

```bash
git clone https://github.com/nikomagit/AMOKIN.git
cd AMOKIN
docker compose up -d --build
curl http://127.0.0.1:7100/health
```

Publica `127.0.0.1:7100` detrás del proxy HTTPS y agrega en Nuvio:

```text
https://addon.tu-dominio.example/manifest.json
```

## Variables de producción

| Variable | Valor recomendado |
|---|---|
| `HOST` | `0.0.0.0` |
| `PORT` | `7100` |
| `LOG_LEVEL` | `info` |
| `ANIMEAV1_BASE_URL` | `https://animeav1.com` |
| `ANIMEAV1_CDN_BASE_URL` | `https://cdn.animeav1.com` |
| `HENTAILA_BASE_URL` | `https://hentaila.com` |
| `HENTAILA_CDN_BASE_URL` | `https://cdn.hentaila.com` |
| `JKANIME_BASE_URL` | `https://jkanime.net` |
| `ANIME_MAPPING_BASE_URL` | `https://animeapi.my.id` |
| `ANILIST_BASE_URL` | `https://graphql.anilist.co` |
| `LATAM_TV_CATALOG_URL` | `https://embed.saohgdassregions.com` |
| `LATAM_TV_PLAYER_HOST_SUFFIXES` | `saohgdassregions.com,ksdjugfssddeports.com` |
| `METADATA_BASE_URL` | `https://v3-cinemeta.strem.io` |
| `METADATA_FALLBACK_BASE_URL` | `https://94c8cb9f702d-tmdb-addon.baby-beamup.club` |
| `CATALOG_CACHE_TTL_MS` | `900000` |

`METADATA_FALLBACK_BASE_URL`, AnimeAPI y AniList son servicios públicos y pueden sustituirse por instancias compatibles, pero su cobertura o disponibilidad no está garantizada. En producción, `TMDB_API_KEY` debe configurarse como secreto de Render para que AMOKIN consulte primero la API oficial y pueda resolver IDs ausentes del mapa comunitario.

## Verificación posterior

Comprueba al menos:

```text
GET /health
GET /manifest.json
GET /catalog/series/hentaila-popular.json
GET /catalog/series/hentaila-airing.json
GET /catalog/series/hentaila-uncensored.json
GET /catalog/tv/latam-tv/genre=Deportes.json
GET /catalog/tv/latam-tv/genre=Regionales.json
```

Después abre una ficha, un episodio y una respuesta `/stream/...`. Confirma que las URLs son HTTPS y que no existe `infoHash`.

## Actualizar un VPS

```bash
git pull --ff-only
docker compose up -d --build
docker compose logs --tail=100 amokin
```

No registres query strings de vídeo, cookies ni headers privados: algunos enlaces contienen tokens temporales. Mantén dependencias e imagen base actualizadas.
