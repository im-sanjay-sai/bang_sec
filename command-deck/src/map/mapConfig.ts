import type { MapViewState } from "@deck.gl/core";

import type { MissionTarget } from "../domain/types";

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export const MAPBOX_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? "mapbox://styles/mapbox/dark-v11";

export type MapVisualModeId = "dark" | "satellite" | "terrain" | "urban3d";

export interface MapVisualMode {
  id: MapVisualModeId;
  label: string;
  shortLabel: string;
  description: string;
}

export const mapVisualModes: MapVisualMode[] = [
  {
    id: "dark",
    label: "Dark Ops",
    shortLabel: "Dark",
    description: "Dark vector basemap with operational overlays.",
  },
  {
    id: "satellite",
    label: "Satellite",
    shortLabel: "Sat",
    description: "Satellite imagery with streets and labels.",
  },
  {
    id: "terrain",
    label: "Terrain",
    shortLabel: "Terrain",
    description: "Outdoor terrain style with elevation relief.",
  },
  {
    id: "urban3d",
    label: "3D Urban",
    shortLabel: "3D",
    description: "Pitched dark map with extruded buildings and signal columns.",
  },
];

export function getMapboxStyle(mode: MapVisualModeId): string {
  switch (mode) {
    case "satellite":
      return "mapbox://styles/mapbox/satellite-streets-v12";
    case "terrain":
      return "mapbox://styles/mapbox/outdoors-v12";
    case "urban3d":
      return "mapbox://styles/mapbox/dark-v11";
    case "dark":
    default:
      return MAPBOX_STYLE;
  }
}

export function usesTerrain(mode: MapVisualModeId): boolean {
  return mode === "terrain" || mode === "urban3d";
}

export function uses3dBuildings(mode: MapVisualModeId): boolean {
  return mode === "urban3d";
}

export function buildInitialViewState(target: MissionTarget): MapViewState {
  const radius = Math.max(target.radiusKm, 1);

  return {
    longitude: target.lon,
    latitude: target.lat,
    zoom: radius > 28 ? 8.4 : radius > 20 ? 9 : 9.6,
    pitch: 58,
    bearing: -18,
  };
}
