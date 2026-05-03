import { createMockReport, targets } from "../data/mockMission";
import type { MissionReport, MissionTarget } from "../domain/types";
import { buildInitialViewState } from "./mapConfig";

export interface MapSurfaceDefinition {
  id: string;
  order: number;
  label: string;
  target: MissionTarget;
  report: MissionReport;
  viewState: ReturnType<typeof buildInitialViewState>;
}

export const mapSurfaces: MapSurfaceDefinition[] = targets.map((target, index) => {
  const report = createMockReport(target.id);

  return {
    id: target.id,
    order: index + 1,
    label: target.name,
    target,
    report,
    viewState: buildInitialViewState(target),
  };
});

export const defaultMapSurfaceId = mapSurfaces[0]?.id ?? "fort-liberty";

export function getMapSurface(surfaceId: string): MapSurfaceDefinition {
  return mapSurfaces.find((surface) => surface.id === surfaceId) ?? mapSurfaces[0];
}

export function getVisibleLayerIds(report: MissionReport): string[] {
  return report.layers.filter((layer) => layer.visible).map((layer) => layer.id);
}

export function resolveMapSurfaceCommand(command: string): string | null {
  const normalized = command.toLowerCase();
  const wantsMap =
    normalized.includes("map") ||
    normalized.includes("surface") ||
    normalized.includes("show") ||
    normalized.includes("display") ||
    normalized.includes("switch");

  if (!wantsMap) {
    return null;
  }

  const byName = mapSurfaces.find((surface) => {
    const targetName = surface.target.name.toLowerCase();
    const shortName = targetName.split(/\s+/)[0];
    return normalized.includes(targetName) || normalized.includes(shortName);
  });
  if (byName) {
    return byName.id;
  }

  const ordinalMatch =
    normalized.match(/\bmap\s+(one|1|first)\b/) ??
    normalized.match(/\b(one|1|first)\s+map\b/);
  if (ordinalMatch) {
    return mapSurfaces[0]?.id ?? null;
  }

  const secondMatch =
    normalized.match(/\bmap\s+(two|2|second)\b/) ??
    normalized.match(/\b(two|2|second)\s+map\b/);
  if (secondMatch) {
    return mapSurfaces[1]?.id ?? null;
  }

  const thirdMatch =
    normalized.match(/\bmap\s+(three|3|third)\b/) ??
    normalized.match(/\b(three|3|third)\s+map\b/);
  if (thirdMatch) {
    return mapSurfaces[2]?.id ?? null;
  }

  return null;
}
