import type { MapViewState } from "@deck.gl/core";

import type { MissionTarget } from "../domain/types";

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export const MAPBOX_STYLE =
  (import.meta.env.VITE_MAPBOX_STYLE as string | undefined) ?? "mapbox://styles/mapbox/dark-v11";

export function buildInitialViewState(target: MissionTarget): MapViewState {
  const radius = Math.max(target.radiusKm, 1);

  return {
    longitude: target.lon,
    latitude: target.lat,
    zoom: radius > 28 ? 8.4 : radius > 20 ? 9 : 9.6,
    pitch: 50,
    bearing: -18,
  };
}
