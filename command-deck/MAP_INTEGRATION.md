# Command Deck Map Integration

## What Changed

The command deck now uses warm deck.gl + Mapbox map surfaces instead of the prior CSS/SVG tactical globe mock. Three surfaces are mounted for the current demo targets:

- Fort Liberty
- Norfolk Naval
- Creech AFB

Only one surface is visible at a time, controlled by `activeMapSurfaceId`. Inactive surfaces stay mounted with opacity and pointer-event changes so switching back is immediate.

## Main Implementation

- Added deck.gl, Mapbox GL, and React Map GL dependencies to `command-deck`.
- Added reusable map modules under `src/map/`:
  - `mapConfig.ts` reads `VITE_MAPBOX_TOKEN` and `VITE_MAPBOX_STYLE`.
  - `mapSurfaces.ts` defines the three pre-mounted map surfaces and command resolution helpers.
  - `buildDeckLayers.ts` converts command-deck map payloads into deck.gl layers.
- Replaced `TacticalMap` with `DeckMapSurfaceStack`, which mounts all three `DeckMapSurface` instances and shows the active one.
- Added `MapSurfaceSwitcher` for manual surface switching inside the map frame.
- Extended mock mission layers with geospatial payload data for markers, paths, footprints, and heatmaps.
- Added voice/typed command routing for:
  - `show fort liberty map`
  - `show norfolk map`
  - `show creech map`
  - `map one`, `map two`, `map three`

## Runtime Notes

Set `VITE_MAPBOX_TOKEN` before starting the Vite dev server to render the Mapbox basemap. Optionally set `VITE_MAPBOX_STYLE`, for example:

```bash
VITE_MAPBOX_STYLE="mapbox://styles/mapbox/satellite-streets-v12"
```

If `VITE_MAPBOX_TOKEN` is not present, the deck.gl overlays still render over a tactical fallback background.

## Verification

Verified with:

```bash
pnpm build
```

The Vite app was also run locally on `http://localhost:5175/` and tested with a typed command that switched the active surface to Norfolk Naval.
