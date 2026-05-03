import type { MissionReport, MissionTarget } from "../domain/types";
import { DeckMapSurfaceStack } from "./DeckMapSurfaceStack";

interface TacticalMapProps {
  activeLayerIds: string[];
  activeMapSurfaceId: string;
  onSurfaceChange(surfaceId: string): void;
  report: MissionReport | null;
  target: MissionTarget;
}

export function TacticalMap({
  activeLayerIds,
  activeMapSurfaceId,
  onSurfaceChange,
  report,
}: TacticalMapProps) {
  return (
    <DeckMapSurfaceStack
      activeLayerIds={activeLayerIds}
      activeMapSurfaceId={activeMapSurfaceId}
      currentReport={report}
      onSurfaceChange={onSurfaceChange}
    />
  );
}
