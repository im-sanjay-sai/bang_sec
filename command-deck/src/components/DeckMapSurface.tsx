import { useMemo } from "react";

import { DeckGL } from "@deck.gl/react";
import MapboxMap, { NavigationControl } from "react-map-gl/mapbox";

import type { MissionReport } from "../domain/types";
import { buildDeckLayers, getTooltipContent } from "../map/buildDeckLayers";
import { MAPBOX_STYLE, MAPBOX_TOKEN } from "../map/mapConfig";
import type { MapSurfaceDefinition } from "../map/mapSurfaces";
import { cn } from "../utils/tailwind";

interface DeckMapSurfaceProps {
  active: boolean;
  activeLayerIds: string[];
  report: MissionReport;
  surface: MapSurfaceDefinition;
}

export function DeckMapSurface({ active, activeLayerIds, report, surface }: DeckMapSurfaceProps) {
  const deckLayers = useMemo(
    () => buildDeckLayers({ report, activeLayerIds, target: surface.target }),
    [activeLayerIds, report, surface.target]
  );

  return (
    <div
      aria-hidden={!active}
      className={cn(
        "absolute inset-0 overflow-hidden bg-black transition-opacity duration-150",
        active ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
      )}
      data-map-surface={surface.id}
    >
      {!MAPBOX_TOKEN ? (
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(220_253_56_/_0.12),transparent_28%),linear-gradient(180deg,#050806_0%,#000_100%)]" />
      ) : null}

      <DeckGL
        controller={active}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
        getTooltip={getTooltipContent}
        initialViewState={surface.viewState}
        layers={deckLayers}
        style={{ height: "100%", width: "100%" }}
      >
        {MAPBOX_TOKEN ? (
          <MapboxMap
            attributionControl={false}
            mapStyle={MAPBOX_STYLE}
            mapboxAccessToken={MAPBOX_TOKEN}
            reuseMaps
            style={{ height: "100%", width: "100%" }}
          >
            {active ? <NavigationControl position="top-right" /> : null}
          </MapboxMap>
        ) : null}
      </DeckGL>

      {!MAPBOX_TOKEN ? (
        <div className="pointer-events-none absolute left-ui-sm top-ui-sm border border-warning/40 bg-background/85 px-ui-xs py-ui-xxs font-mono text-[10px] uppercase text-warning">
          VITE_MAPBOX_TOKEN missing - overlay fallback
        </div>
      ) : null}
    </div>
  );
}
