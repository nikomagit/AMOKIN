# Sports TV poster sources

The 2:3 poster cards in `posters/` were generated for AMOKIN from public channel
logos indexed by the [IPTV-org logos API](https://iptv-org.github.io/api/logos.json).
The five channel-to-logo mappings (DSport, DSport+, ESPN, ESPN2 and ESPN3) are
recorded in `scripts/build-latam-tv-posters.py`. Wikimedia-hosted images are
converted through wsrv.nl at build time; the addon serves the generated PNGs
locally and does not depend on that service at playback time. Brand names and
logos remain the property of their respective owners.
