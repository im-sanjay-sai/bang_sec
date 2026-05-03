import { MAPBOX_TOKEN } from "../map/mapConfig";

export interface GeocodedLocation {
  address?: string;
  bbox?: [number, number, number, number];
  category?: string;
  context: GeocodedContext[];
  features: GeocodedFeature[];
  id?: string;
  label: string;
  lat: number;
  lon: number;
  placeType: string;
  placeTypes: string[];
  query: string;
  relevance: number;
  text: string;
}

export interface GeocodedFeature {
  address?: string;
  bbox?: [number, number, number, number];
  category?: string;
  id?: string;
  label: string;
  lat: number;
  lon: number;
  placeType: string;
  placeTypes: string[];
  relevance: number;
  text: string;
}

export interface GeocodedContext {
  id?: string;
  shortCode?: string;
  text: string;
  type: string;
}

interface MapboxFeature {
  address?: string;
  bbox?: [number, number, number, number];
  center?: [number, number];
  context?: Array<{
    id?: string;
    short_code?: string;
    text?: string;
  }>;
  id?: string;
  place_name?: string;
  place_type?: string[];
  properties?: {
    category?: string;
  };
  relevance?: number;
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
  url.searchParams.set("autocomplete", "false");
  url.searchParams.set("language", "en");
  url.searchParams.set("limit", "5");
  url.searchParams.set("types", "address,poi,place,locality,neighborhood,region,district,country");

  const response = await fetch(url.toString());
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as MapboxGeocodeResponse;
  const features = data.features?.map(mapFeature).filter((feature): feature is GeocodedFeature => feature !== null) ?? [];
  const feature = features[0];
  if (!feature) {
    return null;
  }

  const rawFeature = data.features?.[0];
  const context: GeocodedContext[] =
    rawFeature?.context
      ?.map((item) => {
        const text = item.text?.trim();
        if (!text) {
          return null;
        }

        return {
          text,
          type: item.id?.split(".")[0] ?? "context",
          ...(item.id ? { id: item.id } : {}),
          ...(item.short_code ? { shortCode: item.short_code } : {}),
        } satisfies GeocodedContext;
      })
      .filter((item): item is GeocodedContext => item !== null) ?? [];

  return {
    ...feature,
    context,
    features,
    query: trimmed,
  };
}

function mapFeature(feature: MapboxFeature): GeocodedFeature | null {
  const center = feature?.center;
  if (!center || center.length < 2) {
    return null;
  }

  const label = feature.place_name ?? feature.text ?? "Mapbox result";
  const placeTypes = feature.place_type?.filter(Boolean) ?? ["feature"];

  return {
    address: feature.address,
    bbox: feature.bbox,
    category: feature.properties?.category,
    id: feature.id,
    label,
    lat: center[1],
    lon: center[0],
    placeType: placeTypes[0] ?? "feature",
    placeTypes,
    relevance: typeof feature.relevance === "number" ? feature.relevance : 0.72,
    text: feature.text ?? label,
  };
}
