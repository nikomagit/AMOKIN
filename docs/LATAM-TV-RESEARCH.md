# LATAM TV: investigación e integración

Fecha de comprobación: 2026-09-10. La integración se validó primero como addon local aislado y después se incorporó al manifiesto y a las rutas principales de AMOKIN 2.3.0.

## Flujo observado

1. `https://embed.saohgdassregions.com/` entrega el catálogo completo en HTML. Cada tarjeta incluye el nombre visible y un enlace de ficha `/<slug>.php`; no hay API JSON ni carga diferida.
2. La ficha del canal no reproduce directamente. Expone dos embeds por canal: `embed2/<slug>.php` (rotulado **JW PLAYER**) y `embed/<slug>.php` (rotulado **CLAPPR**).
3. Cada embed devuelve un iframe de un host de reproductor. Los deportivos usan `deportes.ksdjugfssddeports.com` y los regionales, `regionales.saohgdassregions.com`; cada variante lleva el mismo `canal`, un `target` distinto (`2` o `3`) y una firma `sig` distinta.
4. El iframe resuelve un `playbackURL` (Clappr) o `file` (JW Player) cuyo endpoint `playlist.php?...&sig=...` responde `application/vnd.apple.mpegurl` y un manifiesto `#EXTM3U`. Sus segmentos incluyen tokens y expiración.

El catálogo, la ficha y los embeds se deben solicitar en el momento de resolver un canal. El playlist HLS no se persiste ni se cachea de forma prolongada.

## Datos necesarios para reproducir

- La opción necesita el URL del playlist HLS recién resuelto.
- El reproductor comprobado entrega correctamente el manifiesto con `Referer` igual a su iframe, `Origin` del iframe y un navegador `User-Agent` moderno. La respuesta no indicó que fuesen necesarias cookies.
- La URL de playlist y los tokens de sus segmentos son temporales. Una URL no se debe reutilizar como identidad del canal.

## Arquitectura local

`src/experimental/latam-tv/client.ts` es el único módulo de obtención y resolución:

- descubre el catálogo y genera IDs estables `latam-tv:<slug>`;
- conserva un único canal por `slug` y tipo `tv`;
- extrae dinámicamente las opciones anunciadas por la ficha;
- valida hosts para evitar seguir iframes arbitrarios;
- resuelve opciones en paralelo, tolera errores individuales y deduplica playlists;
- adjunta headers de reproducción al resultado HLS.

`src/experimental/latam-tv/local-app.ts` sirve un addon Stremio/Nuvio independiente, con sólo `tv`:

- `GET /manifest.json`
- `GET /catalog/tv/latam-tv.json`
- `GET /meta/tv/latam-tv:<slug>.json`
- `GET /stream/tv/latam-tv:<slug>.json`
- `GET /health`

El manifiesto principal expone además el catálogo `latam-tv`, el filtro estándar
`genre` con `Deportes` y `Regionales`, metadatos TV, streams y posters 2:3 alojados
por AMOKIN en `/latam-tv/posters/:slug.png`.

## Integración realizada

1. El cliente de destino recibe `behaviorHints.proxyHeaders.request` para el playlist y los segmentos.
2. `LATAM_TV_CATALOG_URL` y `LATAM_TV_PLAYER_HOST_SUFFIXES` permanecen configurables.
3. Las URLs HLS siguen resolviéndose al seleccionar el canal y nunca se hardcodean.
4. El addon local aislado se conserva como banco de pruebas en el puerto 7101.

## Pruebas

- Unitarias: extracción de catálogo, ID y tipo `tv`, opciones múltiples y deduplicación.
- Locales: `npm run dev:latam-tv`, instalar `http://127.0.0.1:7101/manifest.json` en el cliente y recorrer catálogo → canal → opciones.
- En vivo: `npm run validate:latam-tv`; opcionalmente use `LATAM_TV_CHANNEL=latam-tv:tudn` para validar un canal concreto. El comando exige que cada opción responda con `#EXTM3U`.

## Riesgos operativos

- El HTML, los nombres de reproductor, dominios de iframe o el patrón de `playbackURL` pueden cambiar. Un fallo de una variante no invalida las demás.
- La firma de iframe, playlist y tokens de segmentos caducan; la resolución tardía es obligatoria.
- Un canal puede no tener opciones válidas temporalmente. El endpoint devuelve una lista vacía sólo para ese canal.
