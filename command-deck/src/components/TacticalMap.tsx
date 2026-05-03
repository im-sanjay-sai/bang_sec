import type { MissionReport, MissionTarget } from "../domain/types";
import type { MapSurfaceDefinition } from "../map/mapSurfaces";
import { DeckMapSurfaceStack } from "./DeckMapSurfaceStack";

interface TacticalMapProps {
  activeLayerIds: string[];
  activeMapSurfaceId: string;
  onSurfaceChange(surfaceId: string): void;
  report: MissionReport | null;
  surfaces: MapSurfaceDefinition[];
  target: MissionTarget;
}

export function TacticalMap({
  activeLayerIds,
  activeMapSurfaceId,
  onSurfaceChange,
  report,
  surfaces,
}: TacticalMapProps) {
  return (
    <DeckMapSurfaceStack
      activeLayerIds={activeLayerIds}
      activeMapSurfaceId={activeMapSurfaceId}
      currentReport={report}
      onSurfaceChange={onSurfaceChange}
      surfaces={surfaces}
    />
  );
}
