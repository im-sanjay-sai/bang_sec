import type { AgentDescriptor, MissionReport } from "../domain/types";
import type { MapVisualModeId } from "../map/mapConfig";

export const VOICE_DECK_ACTION_MESSAGE = "command-deck.action";
export const VOICE_DECK_ACTION_RESULT_MESSAGE = "command-deck.action-result";

export type VoiceLoopPhase =
  | "offline"
  | "connecting"
  | "ready"
  | "listening"
  | "hearing"
  | "thinking"
  | "speaking"
  | "muted"
  | "blocked";

export type VoiceDeckActionName =
  | "set_location"
  | "run_assessment"
  | "sync_to_aip"
  | "review_top_finding"
  | "ask_aip"
  | "toggle_layer"
  | "set_map_mode"
  | "get_deck_state"
  | "help";

export interface VoiceDeckAction {
  type: typeof VOICE_DECK_ACTION_MESSAGE;
  action: VoiceDeckActionName;
  requestId?: string;
  text?: string;
  locationName?: string;
  surfaceId?: string;
  targetId?: string;
  prompt?: string;
  layerId?: string;
  layerLabel?: string;
  mapMode?: MapVisualModeId | string;
}

export interface VoiceDeckActionResult {
  type: typeof VOICE_DECK_ACTION_RESULT_MESSAGE;
  action: VoiceDeckActionName;
  ok: boolean;
  requestId?: string;
  text: string;
  error?: string;
  state?: VoiceDeckState;
}

export interface VoiceDeckState {
  activeMapSurfaceId: string;
  selectedTargetId: string;
  selectedTargetName: string;
  mapMode: MapVisualModeId;
  busy: boolean;
  report: {
    targetName?: string;
    score?: number;
    findingCount: number;
    topFinding?: string;
    aipState?: string;
  };
  layers: Array<{
    id: string;
    label: string;
    visible: boolean;
  }>;
  agents: Array<{
    id: string;
    name: string;
    status: string;
    currentTask: string;
  }>;
}

export function createVoiceDeckState(input: {
  activeMapSurfaceId: string;
  selectedTargetId: string;
  selectedTargetName: string;
  mapMode: MapVisualModeId;
  busy: boolean;
  report: MissionReport | null;
  activeLayerIds: string[];
  agents: AgentDescriptor[];
}): VoiceDeckState {
  return {
    activeMapSurfaceId: input.activeMapSurfaceId,
    selectedTargetId: input.selectedTargetId,
    selectedTargetName: input.selectedTargetName,
    mapMode: input.mapMode,
    busy: input.busy,
    report: {
      targetName: input.report?.target.name,
      score: input.report?.score.aggregate,
      findingCount: input.report?.findings.length ?? 0,
      topFinding: input.report?.findings[0]?.title,
      aipState: input.report?.aip.state,
    },
    layers:
      input.report?.layers.map((layer) => ({
        id: layer.id,
        label: layer.label,
        visible: input.activeLayerIds.includes(layer.id),
      })) ?? [],
    agents: input.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      currentTask: agent.currentTask,
    })),
  };
}

export function normalizeVoiceDeckAction(payload: unknown): VoiceDeckAction | null {
  const data = unwrapServerPayload(payload);
  if (!isRecord(data)) {
    return null;
  }

  const type = getString(data.type);
  if (type === "command-deck.location") {
    return {
      type: VOICE_DECK_ACTION_MESSAGE,
      action: "set_location",
      requestId: getString(data.requestId),
      surfaceId: getString(data.surfaceId),
      targetId: getString(data.targetId),
      locationName: getString(data.label),
      text: getString(data.text),
    };
  }

  if (type === "command-deck.location-request") {
    return {
      type: VOICE_DECK_ACTION_MESSAGE,
      action: "set_location",
      requestId: getString(data.requestId),
      locationName: getString(data.locationName) ?? getString(data.query) ?? getString(data.label),
      text: getString(data.text),
    };
  }

  if (type !== VOICE_DECK_ACTION_MESSAGE) {
    return null;
  }

  const action = normalizeActionName(getString(data.action) ?? getString(data.command) ?? getString(data.name));
  if (!action) {
    return null;
  }

  return {
    type: VOICE_DECK_ACTION_MESSAGE,
    action,
    requestId: getString(data.requestId),
    text: getString(data.text),
    locationName: getString(data.locationName) ?? getString(data.location) ?? getString(data.query),
    surfaceId: getString(data.surfaceId),
    targetId: getString(data.targetId),
    prompt: getString(data.prompt),
    layerId: getString(data.layerId),
    layerLabel: getString(data.layerLabel),
    mapMode: getString(data.mapMode) ?? getString(data.mode),
  };
}

export function normalizeMapMode(value: unknown): MapVisualModeId | null {
  const normalized = getString(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "");
  switch (normalized) {
    case "dark":
    case "darkops":
      return "dark";
    case "sat":
    case "satellite":
    case "imagery":
      return "satellite";
    case "terrain":
    case "outdoor":
    case "outdoors":
      return "terrain";
    case "3d":
    case "3durban":
    case "urban":
    case "urban3d":
      return "urban3d";
    default:
      return null;
  }
}

export function formatVoiceActionText(action: VoiceDeckAction): string {
  switch (action.action) {
    case "set_location":
      return `Voice action: set location${action.locationName ? ` to ${action.locationName}` : ""}.`;
    case "run_assessment":
      return `Voice action: run assessment${action.locationName ? ` for ${action.locationName}` : ""}.`;
    case "sync_to_aip":
      return "Voice action: sync active assessment.";
    case "review_top_finding":
      return "Voice action: review top finding.";
    case "ask_aip":
      return action.prompt ? `Voice action: ask AIP, ${action.prompt}` : "Voice action: ask AIP.";
    case "toggle_layer":
      return `Voice action: toggle layer ${action.layerLabel ?? action.layerId ?? "requested"}.`;
    case "set_map_mode":
      return `Voice action: set map mode ${action.mapMode ?? "requested"}.`;
    case "get_deck_state":
      return "Voice action: read deck state.";
    case "help":
      return "Voice action: list available controls.";
  }
}

function normalizeActionName(value: string | undefined): VoiceDeckActionName | null {
  const normalized = value?.toLowerCase().replace(/[\s-]+/g, "_");
  switch (normalized) {
    case "set_location":
    case "location":
    case "focus_location":
    case "move_location":
      return "set_location";
    case "run_assessment":
    case "assessment":
    case "analyze":
    case "assess":
      return "run_assessment";
    case "sync_to_aip":
    case "sync":
    case "push":
    case "push_to_aip":
      return "sync_to_aip";
    case "review_top_finding":
    case "review":
    case "mark_reviewed":
      return "review_top_finding";
    case "ask_aip":
    case "query":
    case "question":
      return "ask_aip";
    case "toggle_layer":
    case "layer":
      return "toggle_layer";
    case "set_map_mode":
    case "map_mode":
      return "set_map_mode";
    case "get_deck_state":
    case "deck_state":
    case "status":
      return "get_deck_state";
    case "help":
      return "help";
    default:
      return null;
  }
}

function unwrapServerPayload(payload: unknown): unknown {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
