import { MAPBOX_TOKEN } from "../map/mapConfig";

export interface GeocodedLocation {
  label: string;
  lat: number;
  lon: number;
  query: string;
}

interface MapboxFeature {
  center?: [number, number];
  place_name?: string;
  text?: string;
}

interface MapboxGeocodeResponse {
  features?: MapboxFeature[];
}

export async function geocodeLocationName(query: string): Promise<GeocodedLocation | null> {
  const trimmed = query.trim();
  if (!trimmed || !MAPBOX_TOKEN) {
    return null;
  }

  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(trimmed)}.json`);
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  url.searchParams.set("limit", "1");
  url.searchParams.set("types", "address,poi,place,locality,neighborhood,region,district,country");

  const response = await fetch(url.toString());
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as MapboxGeocodeResponse;
  const feature = data.features?.[0];
  const center = feature?.center;
  if (!center || center.length < 2) {
    return null;
  }

  return {
    label: feature.place_name ?? feature.text ?? trimmed,
    lat: center[1],
    lon: center[0],
    query: trimmed,
  };
}
