import { useCallback, useMemo, useState } from "react";

import { createLocationContextReport, estimateRadiusKm } from "../data/locationContextReport";
import { defaultAgents, targets } from "../data/mockMission";
import type { AgentDescriptor, ConversationMessage, MapLayer, MissionReport, MissionTarget, TaskEvent } from "../domain/types";
import { buildInitialViewState } from "../map/mapConfig";
import {
  defaultMapSurfaceId,
  extractLocationQuery,
  getMapSurface,
  getVisibleLayerIds,
  mapSurfaces as baseMapSurfaces,
  type MapSurfaceDefinition,
  resolveExactTargetCommand,
  resolveMapSurfaceCommand,
  resolveTargetCommand,
} from "../map/mapSurfaces";
import { palantirBackend } from "../services/palantirAdapter";
import { geocodeLocationName, type GeocodedLocation } from "../services/geocoding";
import {
  askGhostlineVoiceServer,
  createGhostlineMissionReport,
  fetchGhostlineFullPicture,
  formatGhostlineError,
} from "../services/ghostlineVoiceAdapter";
import {
  VOICE_DECK_ACTION_RESULT_MESSAGE,
  formatVoiceActionText,
  type VoiceDeckAction,
  type VoiceDeckActionResult,
  type VoiceLoopPhase,
} from "../services/voiceDeckProtocol";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const uid = () => crypto.randomUUID();

const bootEvents: TaskEvent[] = [
  {
    id: uid(),
    at: now(),
    agent: "system",
    state: "complete",
    message: "Command deck initialized with live Mapbox context and mock Palantir adapter."
  }
];

const initialSurface = getMapSurface(defaultMapSurfaceId);
const initialReport = initialSurface.report;

const bootMessages: ConversationMessage[] = [
  {
    id: uid(),
    role: "voice-agent",
    at: now(),
    text: "Voice channel standing by. Try: analyze Fort Liberty, push to AIP, compare runs, or review top finding."
  }
];

export function useCommandDeck() {
  const [customSurfaces, setCustomSurfaces] = useState<MapSurfaceDefinition[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState(initialSurface.target.id);
  const [activeMapSurfaceId, setActiveMapSurfaceIdState] = useState(initialSurface.id);
  const [report, setReport] = useState<MissionReport | null>(initialReport);
  const [activeLayerIds, setActiveLayerIds] = useState<string[]>(getVisibleLayerIds(initialReport));
  const [events, setEvents] = useState<TaskEvent[]>(bootEvents);
  const [messages, setMessages] = useState<ConversationMessage[]>(bootMessages);
  const [agents, setAgents] = useState<AgentDescriptor[]>(defaultAgents);
  const [busy, setBusy] = useState(false);

  const surfaces = useMemo(() => [...baseMapSurfaces, ...customSurfaces], [customSurfaces]);
  const deckTargets = useMemo(() => surfaces.map((surface) => surface.target), [surfaces]);

  const selectedTarget = useMemo(
    () => getMapSurface(selectedTargetId, surfaces).target,
    [selectedTargetId, surfaces]
  );

  const addEvent = useCallback((event: Omit<TaskEvent, "id" | "at">) => {
    setEvents((current) => [{ id: uid(), at: now(), ...event }, ...current].slice(0, 18));
  }, []);

  const addMessage = useCallback((message: Omit<ConversationMessage, "id" | "at">) => {
    setMessages((current) => [...current.slice(-10), { id: uid(), at: now(), ...message }]);
  }, []);

  const setAgent = useCallback((id: string, patch: Partial<AgentDescriptor>) => {
    setAgents((current) => current.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  }, []);

  const setVoiceLoopPhase = useCallback(
    (phase: VoiceLoopPhase) => {
      const profile = getVoiceLoopProfile(phase);
      setAgent("voice", profile);
      if (phase === "connecting") {
        setAgent("system", { status: "working", currentTask: "Starting RTVI voice loop" });
      }
      if (phase === "ready" || phase === "listening") {
        setAgent("system", { status: "complete", currentTask: "Voice handoff guard armed" });
      }
      if (phase === "blocked") {
        setAgent("system", { status: "blocked", currentTask: "Voice loop needs operator attention" });
      }
    },
    [setAgent]
  );

  const setActiveMapSurfaceId = useCallback(
    (surfaceId: string) => {
      const surface = getMapSurface(surfaceId, surfaces);
      setActiveMapSurfaceIdState(surface.id);
      setSelectedTargetId(surface.target.id);
      setReport(surface.report);
      setActiveLayerIds(getVisibleLayerIds(surface.report));
      addEvent({
        agent: "voice",
        state: "complete",
        message: `Displayed ${surface.label} deck.gl surface.`,
      });
    },
    [addEvent, surfaces]
  );

  const focusLocationByName = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        return false;
      }

      const knownSurfaceId = resolveExactTargetCommand(trimmed, surfaces);
      if (knownSurfaceId) {
        const surface = getMapSurface(knownSurfaceId, surfaces);
        setActiveMapSurfaceId(surface.id);
        addMessage({ role: "voice-agent", text: `Displaying ${surface.label} map surface.` });
        return true;
      }

      const geocoded = await geocodeLocationName(trimmed);
      if (!geocoded) {
        addMessage({ role: "voice-agent", text: `I could not locate ${trimmed} on the map.` });
        return false;
      }

      const existingSurface = surfaces.find((surface) => isSameGeocodedLocation(surface, geocoded));
      if (existingSurface) {
        setActiveMapSurfaceId(existingSurface.id);
        addMessage({ role: "voice-agent", text: `Displaying ${existingSurface.label} map surface.` });
        return true;
      }

      const surface = buildAdHocSurface(geocoded, baseMapSurfaces.length + customSurfaces.length + 1);
      setCustomSurfaces((current) =>
        current.some((item) => item.id === surface.id)
          ? current
          : [...current, { ...surface, order: baseMapSurfaces.length + current.length + 1 }]
      );
      setActiveMapSurfaceIdState(surface.id);
      setSelectedTargetId(surface.target.id);
      setReport(surface.report);
      setActiveLayerIds(getVisibleLayerIds(surface.report));
      addEvent({
        agent: "voice",
        state: "complete",
        message: `Created ad hoc map surface for ${surface.label}.`,
      });
      addMessage({ role: "voice-agent", text: `Displaying ${surface.label} map surface.` });
      return true;
    },
    [addEvent, addMessage, customSurfaces.length, setActiveMapSurfaceId, surfaces]
  );

  const runAssessment = useCallback(
    async (targetId = selectedTargetId) => {
      const targetSurface = surfaces.find((surface) => surface.target.id === targetId || surface.id === targetId) ?? surfaces[0];
      const target = targetSurface.target;
      setBusy(true);
      setSelectedTargetId(target.id);
      setAgent("voice", { status: "working", currentTask: `Tasking ${target.name}` });
      setAgent("fusion", { status: "working", currentTask: "Running collector fan-out" });
      addMessage({ role: "voice-agent", text: `Starting defensive assessment for ${target.name}.` });

      const steps = [
        "Normalizing target radius and ontology keys.",
        "Collecting aerial, public-web, movement, and revisit signals.",
        "Fusing findings into a command-review summary.",
        "Preparing local run package for AIP writeback."
      ];

      for (const step of steps) {
        addEvent({ agent: "fusion", state: "running", message: step });
        await new Promise((resolve) => window.setTimeout(resolve, 360));
      }

      try {
        const nextReport =
          (await loadGhostlineReport(target).catch((error: unknown) => {
            addEvent({
              agent: "aip",
              state: "blocked",
              message: `Ghostline voice server unavailable: ${formatGhostlineError(error)} Falling back to local adapter.`,
            });
            return null;
          })) ??
          (isBaseTarget(target.id)
            ? await palantirBackend.runAssessment(target.id)
            : refreshReport(targetSurface.report));

        setActiveMapSurfaceIdState(target.id);
        setReport(nextReport);
        setActiveLayerIds(getVisibleLayerIds(nextReport));
        setAgent("fusion", { status: "complete", currentTask: "Assessment package ready" });
        setAgent("voice", { status: "listening", currentTask: "Awaiting command" });
        addEvent({ agent: "fusion", state: "complete", message: `${nextReport.target.name} assessment generated.` });
        addMessage({
          role: "voice-agent",
          text: `${nextReport.target.name} exposure score is ${nextReport.score.aggregate}. ${nextReport.findings.length} findings are staged.`
        });
      } finally {
        setBusy(false);
      }
    },
    [addEvent, addMessage, selectedTargetId, setAgent, surfaces]
  );

  const syncToAip = useCallback(async () => {
    if (!report) {
      addMessage({ role: "voice-agent", text: "No active assessment to sync. Run an analysis first." });
      return;
    }
    setReport({ ...report, aip: { ...report.aip, state: "syncing" } });
    setAgent("aip", { status: "working", currentTask: "Applying Ontology action" });
    addEvent({ agent: "aip", state: "running", message: "Calling mock syncOpsecAnalysisRun action." });
    const receipt = await palantirBackend.syncAssessment(report);
    setReport({ ...report, aip: receipt });
    setAgent("aip", { status: "complete", currentTask: "Ontology object available" });
    addEvent({ agent: "aip", state: "complete", message: `Synced ${receipt.objectRid}.` });
    addMessage({ role: "voice-agent", text: "Assessment synced to the mock Palantir ontology." });
  }, [addEvent, addMessage, report, setAgent]);

  const reviewTopFinding = useCallback(async () => {
    if (!report || !report.findings[0]) {
      addMessage({ role: "voice-agent", text: "No finding is available for review." });
      return;
    }
    const topFinding = report.findings[0];
    addEvent({ agent: "aip", state: "running", message: `Marking ${topFinding.id} reviewed.` });
    const nextReport = await palantirBackend.markFindingReviewed(report, topFinding.id);
    setReport(nextReport);
    addMessage({ role: "voice-agent", text: `${topFinding.title} marked reviewed in the local mock run.` });
  }, [addEvent, addMessage, report]);

  const askAip = useCallback(
    async (prompt: string) => {
      if (!report) {
        addMessage({ role: "voice-agent", text: "No active run is loaded for AIP context." });
        return;
      }
      setAgent("aip", { status: "working", currentTask: "Answering ontology query" });
      addEvent({ agent: "aip", state: "running", message: "Querying Ghostline voice-server context." });
      const answer = await askGhostlineVoiceServer(prompt, report.target.name).catch(async (error: unknown) => {
        addEvent({
          agent: "aip",
          state: "blocked",
          message: `Ghostline query unavailable: ${formatGhostlineError(error)} Falling back to mock AIP context.`,
        });
        return palantirBackend.askAip(report, prompt);
      });
      setAgent("aip", { status: "idle", currentTask: "Ontology query" });
      addMessage({ role: "voice-agent", text: answer });
    },
    [addEvent, addMessage, report, setAgent]
  );

  const sendCommand = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }
      addMessage({ role: "operator", text: trimmed });
      const command = trimmed.toLowerCase();
      const matchedTargetId = resolveTargetCommand(command);
      const matchedTarget = deckTargets.find((target) => target.id === matchedTargetId);
      const mapSurfaceId = resolveMapSurfaceCommand(command);
      const locationQuery = extractLocationQuery(trimmed);
      const exactLocationTargetId = locationQuery ? resolveExactTargetCommand(locationQuery, surfaces) : null;

      if (locationQuery && !exactLocationTargetId && !isOrdinalLocationQuery(locationQuery)) {
        const focused = await focusLocationByName(locationQuery);
        if (focused) {
          return;
        }
      }

      if (command.includes("analyze") || command.includes("assess")) {
        if (!matchedTarget && locationQuery) {
          const focused = await focusLocationByName(locationQuery);
          if (focused) {
            return;
          }
        }
        await runAssessment(exactLocationTargetId ?? matchedTarget?.id ?? selectedTargetId);
        return;
      }

      if (exactLocationTargetId || mapSurfaceId) {
        const surface = getMapSurface(exactLocationTargetId ?? mapSurfaceId!, surfaces);
        setActiveMapSurfaceId(surface.id);
        addMessage({ role: "voice-agent", text: `Displaying ${surface.label} map surface.` });
        return;
      }
      if (locationQuery) {
        const focused = await focusLocationByName(locationQuery);
        if (focused) {
          return;
        }
      }
      if (command.includes("push") || command.includes("sync")) {
        await syncToAip();
        return;
      }
      if (command.includes("review")) {
        await reviewTopFinding();
        return;
      }
      if (
        command.includes("compare") ||
        command.includes("aip") ||
        command.includes("cascade") ||
        command.includes("adversary") ||
        command.includes("mitigat") ||
        command.includes("recommend") ||
        command.includes("current state") ||
        command.includes("live state")
      ) {
        await askAip(trimmed);
        return;
      }
      addMessage({
        role: "voice-agent",
        text: "Command received. Available actions: analyze target, push to AIP, compare runs, review top finding."
      });
    },
    [addMessage, askAip, deckTargets, focusLocationByName, reviewTopFinding, runAssessment, selectedTargetId, setActiveMapSurfaceId, surfaces, syncToAip]
  );

  const toggleLayer = useCallback((layerId: string) => {
    setActiveLayerIds((current) =>
      current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]
    );
  }, []);

  const executeVoiceAction = useCallback(
    async (action: VoiceDeckAction): Promise<VoiceDeckActionResult> => {
      const actionText = formatVoiceActionText(action);
      setAgent("system", { status: "working", currentTask: actionText });
      addEvent({ agent: "system", state: "running", message: actionText });

      try {
        let text = "";

        switch (action.action) {
          case "set_location": {
            const surfaceId = resolveVoiceSurfaceId(action, surfaces);
            if (surfaceId) {
              const surface = getMapSurface(surfaceId, surfaces);
              setActiveMapSurfaceId(surface.id);
              text = `Loaded ${surface.label}.`;
              break;
            }

            if (!action.locationName) {
              throw new Error("No location was supplied.");
            }

            const focused = await focusLocationByName(action.locationName);
            if (!focused) {
              throw new Error(`Could not locate ${action.locationName}.`);
            }

            text = `Loaded ${action.locationName}.`;
            break;
          }

          case "run_assessment": {
            const surfaceId = resolveVoiceSurfaceId(action, surfaces);
            const targetId = surfaceId ?? selectedTargetId;
            const target = getMapSurface(targetId, surfaces).target;
            await runAssessment(targetId);
            text = `Assessment complete for ${target.name}.`;
            break;
          }

          case "sync_to_aip":
            await syncToAip();
            text = "Sync action routed to the AIP worker.";
            break;

          case "review_top_finding":
            await reviewTopFinding();
            text = "Top finding review action routed.";
            break;

          case "ask_aip": {
            const prompt = action.prompt ?? action.text ?? "Summarize active assessment for command review.";
            await askAip(prompt);
            text = "AIP query routed.";
            break;
          }

          case "toggle_layer": {
            const layer = resolveVoiceLayer(action, report);
            if (!layer) {
              throw new Error(`Layer ${action.layerLabel ?? action.layerId ?? "requested"} is not available.`);
            }
            toggleLayer(layer.id);
            text = `Toggled ${layer.label}.`;
            break;
          }

          case "get_deck_state":
            text = report
              ? `${report.target.name} is active. Score ${report.score.aggregate}. ${report.findings.length} findings staged.`
              : "No assessment is loaded.";
            break;

          case "help":
            text = "Voice controls available: set location, run assessment, sync, review top finding, ask AIP, toggle layers, and set map mode.";
            addMessage({ role: "voice-agent", text });
            break;

          case "set_map_mode":
            text = "Map mode action is handled by the command center shell.";
            break;
        }

        setAgent("system", { status: "complete", currentTask: "Voice action committed" });
        addEvent({ agent: "system", state: "complete", message: text });
        return {
          type: VOICE_DECK_ACTION_RESULT_MESSAGE,
          action: action.action,
          requestId: action.requestId,
          ok: true,
          text,
        };
      } catch (error) {
        const text = error instanceof Error ? error.message : "Voice action failed.";
        setAgent("system", { status: "blocked", currentTask: text });
        addEvent({ agent: "system", state: "blocked", message: text });
        return failVoiceAction(action, text);
      }
    },
    [
      addEvent,
      addMessage,
      askAip,
      focusLocationByName,
      report,
      reviewTopFinding,
      runAssessment,
      selectedTargetId,
      setActiveMapSurfaceId,
      setAgent,
      surfaces,
      syncToAip,
      toggleLayer,
    ]
  );

  return {
    activeLayerIds,
    activeMapSurfaceId,
    agents,
    busy,
    events,
    messages,
    report,
    selectedTarget,
    selectedTargetId,
    surfaces,
    targets: deckTargets,
    askAip,
    focusLocationByName,
    reviewTopFinding,
    runAssessment,
    sendCommand,
    setActiveMapSurfaceId,
    setSelectedTargetId,
    setVoiceLoopPhase,
    syncToAip,
    executeVoiceAction,
    toggleLayer
  };
}

function isBaseTarget(targetId: string): boolean {
  return targets.some((target) => target.id === targetId);
}

function getVoiceLoopProfile(phase: VoiceLoopPhase): Partial<AgentDescriptor> {
  switch (phase) {
    case "connecting":
      return { status: "working", currentTask: "Connecting Pipecat room" };
    case "ready":
      return { status: "listening", currentTask: "Voice link ready" };
    case "listening":
      return { status: "listening", currentTask: "Listening for operator" };
    case "hearing":
      return { status: "hearing", currentTask: "Capturing operator turn" };
    case "thinking":
      return { status: "thinking", currentTask: "Resolving operator intent" };
    case "speaking":
      return { status: "speaking", currentTask: "Speaking response" };
    case "muted":
      return { status: "idle", currentTask: "Microphone muted" };
    case "blocked":
      return { status: "blocked", currentTask: "Voice loop blocked" };
    case "offline":
    default:
      return { status: "idle", currentTask: "Voice disconnected" };
  }
}

function failVoiceAction(action: VoiceDeckAction, text: string): VoiceDeckActionResult {
  return {
    type: VOICE_DECK_ACTION_RESULT_MESSAGE,
    action: action.action,
    requestId: action.requestId,
    ok: false,
    text,
    error: text,
  };
}

function resolveVoiceSurfaceId(action: VoiceDeckAction, surfaces: MapSurfaceDefinition[]): string | null {
  const explicitId = action.surfaceId ?? action.targetId;
  if (explicitId) {
    const surface = surfaces.find((item) => item.id === explicitId || item.target.id === explicitId);
    if (surface) {
      return surface.id;
    }
  }

  if (action.locationName) {
    return resolveExactTargetCommand(action.locationName, surfaces);
  }

  return null;
}

function resolveVoiceLayer(action: VoiceDeckAction, report: MissionReport | null): MapLayer | null {
  if (!report) {
    return null;
  }

  const layerId = action.layerId?.toLowerCase();
  const layerLabel = action.layerLabel?.toLowerCase();
  return (
    report.layers.find((layer) => layerId && layer.id.toLowerCase() === layerId) ??
    report.layers.find((layer) => layerLabel && layer.label.toLowerCase() === layerLabel) ??
    null
  );
}

async function loadGhostlineReport(target: MissionTarget): Promise<MissionReport> {
  const picture = await fetchGhostlineFullPicture(target.name);
  return createGhostlineMissionReport(picture, target);
}

function buildAdHocSurface(location: GeocodedLocation, order: number): MapSurfaceDefinition {
  const target = buildAdHocTarget(location);
  const report = createLocationContextReport(target, location);

  return {
    id: target.id,
    order,
    label: target.name,
    target,
    report,
    viewState: buildInitialViewState(target),
  };
}

function buildAdHocTarget(location: GeocodedLocation): MissionTarget {
  return {
    id: `adhoc-${slugify(location.label)}-${stableHash(`${location.lon},${location.lat}`)}`,
    name: location.label,
    lat: location.lat,
    lon: location.lon,
    radiusKm: estimateRadiusKm(location),
    theater: location.placeType,
  };
}

function refreshReport(report: MissionReport): MissionReport {
  return {
    ...report,
    runId: `run-${report.target.id}-${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
  };
}

function isOrdinalLocationQuery(query: string): boolean {
  return /^(one|two|three|1|2|3|first|second|third)$/.test(query.trim().toLowerCase());
}

function isSameGeocodedLocation(surface: MapSurfaceDefinition, location: GeocodedLocation): boolean {
  const sameLabel = surface.label.toLowerCase() === location.label.toLowerCase();
  const sameCoordinates =
    Math.abs(surface.target.lat - location.lat) < 0.01 &&
    Math.abs(surface.target.lon - location.lon) < 0.01;

  return sameLabel || sameCoordinates;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return slug || "location";
}

function stableHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}
