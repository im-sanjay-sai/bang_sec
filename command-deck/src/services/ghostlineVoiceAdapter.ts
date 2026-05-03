import type { Finding, MapLayer, MissionReport, MissionScore, MissionTarget, Severity } from "../domain/types";

const DEFAULT_VOICE_SERVER_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 9000;

type VoiceErrorPayload = {
  error: string;
};

type VoiceEntityRef = {
  id: string;
  name: string;
};

export interface VoiceAssessment {
  location: string;
  exposure_score: number;
  risk_level: string;
  strava_score: number;
  aircraft_score: number;
  satellite_score: number;
  brief: string;
  lat: number;
  lon: number;
  assessment_id: string;
  assessment_timestamp?: string;
  foundry_url?: string;
}

export interface VoiceCascade {
  location: string;
  lat: number;
  lon: number;
  chain_depth: number;
  linked_units: VoiceEntityRef[];
  linked_platforms: VoiceEntityRef[];
  linked_sensors: VoiceEntityRef[];
  intelligence_compromised: string;
  adversary_action_likely: string;
  recommended_mitigation: string;
  cascade_score: number;
  risk_level: string;
  confidence?: string;
  cascade_id?: string;
  source_assessment_id?: string;
  foundry_url?: string;
}

export interface VoiceAdversaryAction {
  action_id: string;
  action_type: string;
  target_entity_name: string;
  target_entity_id: string;
  capability_required: string;
  timeline: string;
  rationale: string;
  confidence: string;
  foundry_url?: string;
}

type VoiceAircraft = {
  hex?: string;
  fr24_id?: string;
  callsign?: string | null;
  lat?: number;
  lon?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  aircraft_type?: string;
  is_military?: boolean;
};

type VoiceAircraftState = {
  aircraft_count?: number;
  military_count?: number;
  aircraft?: VoiceAircraft[];
  data_available?: boolean;
  error?: string;
};

type VoiceSatellitePass = {
  satellite?: string;
  rise_utc?: string;
  set_utc?: string;
  max_elevation_deg?: number;
  duration_seconds?: number;
  ground_track?: Array<{ lat?: number; lon?: number; time_offset_sec?: number }>;
};

type VoiceSatelliteState = {
  next_pass?: VoiceSatellitePass | null;
  passes_in_window?: number;
  all_passes?: VoiceSatellitePass[];
  data_available?: boolean;
  error?: string;
};

type VoiceNewsArticle = {
  title?: string;
  url?: string;
  published_at?: string;
  snippet?: string;
};

type VoiceNewsState = {
  article_count?: number;
  articles?: VoiceNewsArticle[];
  data_available?: boolean;
  error?: string;
};

export interface VoiceCurrentState {
  center?: { lat?: number; lon?: number };
  location_name?: string;
  aircraft?: VoiceAircraftState;
  satellite?: VoiceSatelliteState;
  news?: VoiceNewsState;
  sources_succeeded?: string[];
  queried_at?: string;
}

export interface VoiceFullPicture {
  assessment: VoiceAssessment;
  cascade: VoiceCascade | VoiceErrorPayload;
  adversary_actions: VoiceAdversaryAction[];
  current_state: VoiceCurrentState;
  provenance_summary?: {
    total_entities?: number;
    high_confidence_count?: number;
    sources?: string[];
  };
}

export interface VoiceLocationComparison {
  location: string;
  lat: number;
  lon: number;
  cascade_score: number;
  risk_level: string;
  chain_depth: number;
  primary_concern: string;
  cascade_id?: string;
  foundry_url?: string;
}

export interface VoiceMitigations {
  location: string;
  primary_mitigation: string;
  alternative_mitigations: string[];
  foundry_urls?: {
    cascade?: string | null;
    assessment?: string | null;
  };
}

export class GhostlineVoiceServerError extends Error {
  readonly payload?: unknown;
  readonly status?: number;
  readonly unavailable: boolean;

  constructor(message: string, options: { payload?: unknown; status?: number; unavailable?: boolean } = {}) {
    super(message);
    this.name = "GhostlineVoiceServerError";
    this.payload = options.payload;
    this.status = options.status;
    this.unavailable = options.unavailable ?? false;
  }
}

export async function fetchGhostlineFullPicture(location: string): Promise<VoiceFullPicture> {
  return requestJson<VoiceFullPicture>("voice/get_full_picture", { location });
}

export async function fetchGhostlineComparison(): Promise<VoiceLocationComparison[]> {
  return requestJson<VoiceLocationComparison[]>("voice/compare_locations");
}

export async function fetchGhostlineMitigations(location: string): Promise<VoiceMitigations> {
  return requestJson<VoiceMitigations>("voice/recommend_mitigations", { location });
}

export async function fetchGhostlineCurrentState(target: MissionTarget): Promise<VoiceCurrentState> {
  return requestJson<VoiceCurrentState>("voice/get_current_state", {
    lat: target.lat,
    lon: target.lon,
    location_name: target.name,
  });
}

export function createGhostlineMissionReport(picture: VoiceFullPicture, fallbackTarget: MissionTarget): MissionReport {
  const assessment = picture.assessment;
  const cascade = isVoiceCascade(picture.cascade) ? picture.cascade : null;
  const target: MissionTarget = {
    ...fallbackTarget,
    name: assessment.location || fallbackTarget.name,
    lat: finiteNumber(assessment.lat, fallbackTarget.lat),
    lon: finiteNumber(assessment.lon, fallbackTarget.lon),
    theater: "Ghostline Foundry",
  };
  const score: MissionScore = {
    aggregate: clampScore(assessment.exposure_score),
    movement: clampScore(assessment.strava_score),
    personnel: clampScore(cascade?.cascade_score ?? assessment.exposure_score),
    facility: clampScore(cascade ? 30 + cascade.chain_depth * 12 : assessment.satellite_score),
    aerial: clampScore(Math.round((assessment.aircraft_score + assessment.satellite_score) / 2)),
  };

  return {
    runId: `ghostline-${target.id}-${Date.now().toString(36)}`,
    target,
    generatedAt: assessment.assessment_timestamp ?? new Date().toISOString(),
    mode: "live",
    score,
    findings: buildGhostlineFindings(picture, target),
    layers: buildGhostlineLayers(picture, target),
    narrative: buildNarrative(picture),
    mitigationPriorities: buildMitigationPriorities(picture),
    aip: {
      state: "synced",
      objectRid: assessment.assessment_id ? `OpsecAssessment:${assessment.assessment_id}` : undefined,
      actionName: "ghostline.get_full_picture",
      operationId: cascade?.cascade_id,
      lastSyncedAt: new Date().toISOString(),
    },
  };
}

export async function askGhostlineVoiceServer(prompt: string, location: string): Promise<string> {
  const normalized = prompt.toLowerCase();

  if (/\b(compare|leaderboard|rank|most exposed|highest risk)\b/.test(normalized)) {
    return formatComparison(await fetchGhostlineComparison());
  }

  if (/\b(mitigat|recommend|action plan|reduce)\b/.test(normalized)) {
    return formatMitigations(await fetchGhostlineMitigations(location));
  }

  const picture = await fetchGhostlineFullPicture(location);
  if (/\b(current|live|state|aircraft|satellite|news)\b/.test(normalized)) {
    return formatCurrentState(picture.current_state);
  }
  if (/\b(adversary|actions?|do next|exploit)\b/.test(normalized)) {
    return formatAdversaryActions(picture.adversary_actions);
  }
  if (/\b(cascade|infer|chain|compromised)\b/.test(normalized)) {
    return formatCascade(picture.cascade);
  }

  return formatFullPicture(picture);
}

export function formatGhostlineError(error: unknown): string {
  if (error instanceof GhostlineVoiceServerError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Ghostline voice server request failed.";
}

function getVoiceServerBaseUrl(): string | null {
  const raw = String(import.meta.env.VITE_GHOSTLINE_VOICE_SERVER_URL ?? DEFAULT_VOICE_SERVER_URL).trim();
  if (!raw || /^(off|disabled|false)$/i.test(raw)) {
    return null;
  }
  return raw.endsWith("/") ? raw : `${raw}/`;
}

async function requestJson<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const baseUrl = getVoiceServerBaseUrl();
  if (!baseUrl) {
    throw new GhostlineVoiceServerError("Ghostline voice server is disabled.", { unavailable: true });
  }

  const url = new URL(endpoint, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let payload: unknown = null;

  try {
    const response = await fetch(url, { signal: controller.signal });
    payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new GhostlineVoiceServerError(extractPayloadMessage(payload) ?? `Ghostline voice server returned HTTP ${response.status}.`, {
        payload,
        status: response.status,
      });
    }

    if (isVoiceError(payload)) {
      throw new GhostlineVoiceServerError(payload.error, { payload, status: response.status });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof GhostlineVoiceServerError) {
      throw error;
    }

    const aborted = error instanceof DOMException && error.name === "AbortError";
    throw new GhostlineVoiceServerError(
      aborted ? "Ghostline voice server request timed out." : "Ghostline voice server is not reachable.",
      { payload, unavailable: true }
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

function buildGhostlineFindings(picture: VoiceFullPicture, target: MissionTarget): Finding[] {
  const assessment = picture.assessment;
  const cascade = isVoiceCascade(picture.cascade) ? picture.cascade : null;
  const current = picture.current_state;
  const findings: Finding[] = [
    {
      id: assessment.assessment_id || `${target.id}-ghostline-assessment`,
      source: "palantir",
      severity: severityFromScore(assessment.exposure_score),
      title: `Ghostline OPSEC assessment: ${assessment.risk_level || "scored"}`,
      summary: assessment.brief || `${assessment.location} has exposure score ${assessment.exposure_score}.`,
      evidence: assessment.foundry_url || assessment.assessment_id || "Ghostline OpsecAssessment",
      lat: target.lat,
      lon: target.lon,
      status: "new",
    },
  ];

  if (cascade) {
    findings.push({
      id: cascade.cascade_id || `${target.id}-ghostline-cascade`,
      source: "palantir",
      severity: severityFromScore(cascade.cascade_score),
      title: `Cascade risk: ${cascade.risk_level || "scored"}`,
      summary: cascade.intelligence_compromised || cascade.adversary_action_likely || "Cascade analysis is available.",
      evidence: cascade.foundry_url || cascade.cascade_id || "Ghostline CascadeRisk",
      lat: finiteNumber(cascade.lat, target.lat),
      lon: finiteNumber(cascade.lon, target.lon),
      status: "reviewing",
    });
  }

  for (const action of picture.adversary_actions.slice(0, 2)) {
    findings.push({
      id: action.action_id || `${target.id}-adversary-${findings.length}`,
      source: "palantir",
      severity: severityFromConfidence(action.confidence),
      title: action.action_type || "Predicted adversary action",
      summary: [action.target_entity_name, action.timeline, action.rationale || action.capability_required].filter(Boolean).join(" - "),
      evidence: action.foundry_url || action.target_entity_id || "Ghostline AdversaryAction",
      status: "new",
    });
  }

  const aircraftCount = current.aircraft?.aircraft_count ?? 0;
  const militaryCount = current.aircraft?.military_count ?? 0;
  if (current.aircraft?.data_available || aircraftCount > 0) {
    findings.push({
      id: `${target.id}-live-aircraft`,
      source: "adsb",
      severity: militaryCount > 0 ? "high" : aircraftCount > 0 ? "medium" : "low",
      title: "Live aircraft snapshot",
      summary: `${aircraftCount} aircraft within the Ghostline radius; ${militaryCount} classified by heuristic as military.`,
      evidence: "FlightRadar24 realtime enrichment",
      lat: target.lat,
      lon: target.lon,
      status: "new",
    });
  }

  const satelliteCount = current.satellite?.passes_in_window ?? 0;
  if (current.satellite?.data_available || satelliteCount > 0) {
    findings.push({
      id: `${target.id}-live-satellite`,
      source: "satellite",
      severity: satelliteCount > 0 ? "medium" : "low",
      title: "Upcoming satellite collection window",
      summary: `${satelliteCount} Sentinel pass${satelliteCount === 1 ? "" : "es"} found in the current lookahead window.`,
      evidence: "Ghostline realtime satellite enrichment",
      lat: target.lat,
      lon: target.lon,
      status: "new",
    });
  }

  const newsCount = current.news?.article_count ?? 0;
  if (current.news?.data_available || newsCount > 0) {
    findings.push({
      id: `${target.id}-live-news`,
      source: "exa",
      severity: newsCount > 0 ? "medium" : "low",
      title: "Recent public reporting",
      summary: `${newsCount} recent article${newsCount === 1 ? "" : "s"} returned for ${assessment.location}.`,
      evidence: current.news?.articles?.[0]?.url || "Exa realtime enrichment",
      status: "new",
    });
  }

  return findings;
}

function buildGhostlineLayers(picture: VoiceFullPicture, target: MissionTarget): MapLayer[] {
  const layers: MapLayer[] = [
    {
      id: "layer-ghostline-assessment",
      source: "palantir",
      label: "Ghostline assessment",
      type: "marker",
      visible: true,
      count: 1,
      tone: toneFromSeverity(severityFromScore(picture.assessment.exposure_score)),
      data: [
        {
          position: [target.lon, target.lat],
          title: picture.assessment.location,
          detail: `Exposure ${picture.assessment.exposure_score} / ${picture.assessment.risk_level}`,
          radiusMeters: Math.max(360, target.radiusKm * 120),
        },
      ],
    },
  ];

  const aircraft = (picture.current_state.aircraft?.aircraft ?? []).filter(hasAircraftPosition);
  if (aircraft.length > 0) {
    layers.push({
      id: "layer-ghostline-live-aircraft",
      source: "adsb",
      label: "Live aircraft",
      type: "marker",
      visible: true,
      count: aircraft.length,
      tone: aircraft.some((item) => item.is_military) ? "red" : "amber",
      data: aircraft.slice(0, 80).map((item) => ({
        position: [item.lon, item.lat],
        title: item.callsign || item.hex || "Aircraft",
        detail: [
          item.aircraft_type,
          typeof item.altitude === "number" ? `${Math.round(item.altitude)} ft` : null,
          item.is_military ? "military heuristic" : null,
        ].filter(Boolean).join(" / "),
        radiusMeters: item.is_military ? 520 : 360,
      })),
    });
  }

  const nextPass = picture.current_state.satellite?.next_pass;
  const track = (nextPass?.ground_track ?? [])
    .map((point) => [point.lon, point.lat])
    .filter((point): point is [number, number] => point.every((value) => typeof value === "number" && Number.isFinite(value)));
  if (track.length >= 2) {
    layers.push({
      id: "layer-ghostline-satellite-track",
      source: "satellite",
      label: "Next satellite pass",
      type: "path",
      visible: true,
      count: 1,
      tone: "blue",
      data: [
        {
          path: track,
          label: nextPass?.satellite || "Sentinel pass",
          sampleCount: track.length,
          minDistanceKm: 0,
        },
      ],
    });
  }

  if (picture.current_state.satellite?.passes_in_window) {
    layers.push({
      id: "layer-ghostline-satellite-footprint",
      source: "satellite",
      label: "Satellite window",
      type: "footprint",
      visible: true,
      count: picture.current_state.satellite.passes_in_window,
      tone: "blue",
      data: [
        {
          center: [target.lon, target.lat],
          radiusKm: Math.max(target.radiusKm, 8),
          title: "Collection watch area",
        },
      ],
    });
  }

  return layers;
}

function buildNarrative(picture: VoiceFullPicture): string {
  const assessment = picture.assessment;
  const cascade = isVoiceCascade(picture.cascade) ? picture.cascade : null;
  return [
    `${assessment.location} is loaded from the Ghostline voice-server API with exposure score ${assessment.exposure_score}.`,
    assessment.brief,
    cascade?.intelligence_compromised,
    cascade?.adversary_action_likely,
  ].filter(Boolean).join(" ");
}

function buildMitigationPriorities(picture: VoiceFullPicture): string[] {
  const cascade = isVoiceCascade(picture.cascade) ? picture.cascade : null;
  const actions = picture.adversary_actions
    .slice(0, 3)
    .map((action) => action.capability_required || action.rationale)
    .filter((item): item is string => Boolean(item));

  return [
    cascade?.recommended_mitigation,
    ...actions,
    "Use provenance links before command action; Ghostline surfaces synthesized and upstream public-source entities separately.",
  ].filter((item): item is string => Boolean(item));
}

function formatComparison(rows: VoiceLocationComparison[]): string {
  if (rows.length === 0) {
    return "Ghostline comparison returned no populated locations.";
  }
  const top = rows.slice(0, 3).map((row, index) => `${index + 1}. ${row.location}: ${row.cascade_score} ${row.risk_level} risk`).join("; ");
  return `Ghostline comparison: ${top}.`;
}

function formatMitigations(mitigations: VoiceMitigations): string {
  const alternatives = mitigations.alternative_mitigations?.slice(0, 2).join(" ") ?? "";
  return [
    `Ghostline mitigations for ${mitigations.location}.`,
    mitigations.primary_mitigation ? `Primary: ${mitigations.primary_mitigation}` : null,
    alternatives ? `Alternates: ${alternatives}` : null,
  ].filter(Boolean).join(" ");
}

function formatFullPicture(picture: VoiceFullPicture): string {
  const cascade = isVoiceCascade(picture.cascade) ? ` Cascade score ${picture.cascade.cascade_score}; ${picture.cascade.intelligence_compromised}` : "";
  const current = formatCurrentState(picture.current_state);
  return `${picture.assessment.location} exposure score is ${picture.assessment.exposure_score} ${picture.assessment.risk_level}. ${picture.assessment.brief}${cascade} ${current}`;
}

function formatCascade(cascade: VoiceCascade | VoiceErrorPayload): string {
  if (!isVoiceCascade(cascade)) {
    return `Ghostline cascade unavailable: ${cascade.error}`;
  }
  return [
    `Ghostline cascade for ${cascade.location}: score ${cascade.cascade_score} ${cascade.risk_level}.`,
    cascade.intelligence_compromised,
    cascade.adversary_action_likely,
    cascade.recommended_mitigation ? `Mitigation: ${cascade.recommended_mitigation}` : null,
  ].filter(Boolean).join(" ");
}

function formatAdversaryActions(actions: VoiceAdversaryAction[]): string {
  if (actions.length === 0) {
    return "Ghostline returned no predicted adversary actions for the active location.";
  }
  return actions.slice(0, 3).map((action, index) =>
    `${index + 1}. ${action.action_type || "Action"} against ${action.target_entity_name || action.target_entity_id || "target entity"} on ${action.timeline || "unspecified timeline"}: ${action.rationale || action.capability_required}`
  ).join(" ");
}

function formatCurrentState(state: VoiceCurrentState): string {
  const aircraft = state.aircraft;
  const satellite = state.satellite;
  const news = state.news;
  return [
    `Live state for ${state.location_name || "active location"}.`,
    aircraft ? `Aircraft: ${aircraft.aircraft_count ?? 0} total, ${aircraft.military_count ?? 0} military heuristic.` : null,
    satellite ? `Satellite: ${satellite.passes_in_window ?? 0} passes in window.` : null,
    news ? `News: ${news.article_count ?? 0} recent articles.` : null,
  ].filter(Boolean).join(" ");
}

function isVoiceError(value: unknown): value is VoiceErrorPayload {
  return isRecord(value) && typeof value.error === "string";
}

function isVoiceCascade(value: unknown): value is VoiceCascade {
  return isRecord(value) && !isVoiceError(value) && typeof value.location === "string";
}

function hasAircraftPosition(value: VoiceAircraft): value is VoiceAircraft & { lat: number; lon: number } {
  return typeof value.lat === "number" && Number.isFinite(value.lat) && typeof value.lon === "number" && Number.isFinite(value.lon);
}

function extractPayloadMessage(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  for (const key of ["error", "detail", "message", "info"]) {
    const value = payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    const nested = extractPayloadMessage(value);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function severityFromScore(score: number): Severity {
  const safeScore = clampScore(score);
  if (safeScore >= 82) {
    return "critical";
  }
  if (safeScore >= 65) {
    return "high";
  }
  if (safeScore >= 38) {
    return "medium";
  }
  return "low";
}

function severityFromConfidence(confidence: string): Severity {
  switch (confidence.toLowerCase()) {
    case "high":
      return "high";
    case "medium":
      return "medium";
    default:
      return "low";
  }
}

function toneFromSeverity(severity: Severity): MapLayer["tone"] {
  switch (severity) {
    case "critical":
    case "high":
      return "red";
    case "medium":
      return "amber";
    case "low":
    default:
      return "green";
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(finiteNumber(value, 0))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
