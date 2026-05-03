import { useCallback, useMemo, useState } from "react";

import { defaultAgents, targets } from "../data/mockMission";
import type { AgentDescriptor, ConversationMessage, MissionReport, TaskEvent } from "../domain/types";
import {
  defaultMapSurfaceId,
  getMapSurface,
  getVisibleLayerIds,
  resolveMapSurfaceCommand,
} from "../map/mapSurfaces";
import { palantirBackend } from "../services/palantirAdapter";

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const uid = () => crypto.randomUUID();

const bootEvents: TaskEvent[] = [
  {
    id: uid(),
    at: now(),
    agent: "system",
    state: "complete",
    message: "Command deck initialized with mock Palantir adapter."
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
  const [selectedTargetId, setSelectedTargetId] = useState(initialSurface.target.id);
  const [activeMapSurfaceId, setActiveMapSurfaceIdState] = useState(initialSurface.id);
  const [report, setReport] = useState<MissionReport | null>(initialReport);
  const [activeLayerIds, setActiveLayerIds] = useState<string[]>(getVisibleLayerIds(initialReport));
  const [events, setEvents] = useState<TaskEvent[]>(bootEvents);
  const [messages, setMessages] = useState<ConversationMessage[]>(bootMessages);
  const [agents, setAgents] = useState<AgentDescriptor[]>(defaultAgents);
  const [busy, setBusy] = useState(false);

  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? targets[0],
    [selectedTargetId]
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

  const setActiveMapSurfaceId = useCallback(
    (surfaceId: string) => {
      const surface = getMapSurface(surfaceId);
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
    [addEvent]
  );

  const runAssessment = useCallback(
    async (targetId = selectedTargetId) => {
      const target = targets.find((item) => item.id === targetId) ?? targets[0];
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

      const nextReport = await palantirBackend.runAssessment(target.id);
      setActiveMapSurfaceIdState(target.id);
      setReport(nextReport);
      setActiveLayerIds(getVisibleLayerIds(nextReport));
      setAgent("fusion", { status: "complete", currentTask: "Assessment package ready" });
      setAgent("voice", { status: "listening", currentTask: "Awaiting command" });
      addEvent({ agent: "fusion", state: "complete", message: `${target.name} assessment generated.` });
      addMessage({
        role: "voice-agent",
        text: `${target.name} exposure score is ${nextReport.score.aggregate}. ${nextReport.findings.length} findings are staged.`
      });
      setBusy(false);
    },
    [addEvent, addMessage, selectedTargetId, setAgent]
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
      addEvent({ agent: "aip", state: "running", message: "Querying mock AIP context." });
      const answer = await palantirBackend.askAip(report, prompt);
      setAgent("aip", { status: "idle", currentTask: "Ontology writeback" });
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
      const matchedTarget = targets.find((target) => command.includes(target.name.toLowerCase()));
      const mapSurfaceId = resolveMapSurfaceCommand(command);

      if (mapSurfaceId) {
        const surface = getMapSurface(mapSurfaceId);
        setActiveMapSurfaceId(surface.id);
        addMessage({ role: "voice-agent", text: `Displaying ${surface.label} map surface.` });
        return;
      }

      if (command.includes("analyze") || command.includes("assess")) {
        await runAssessment(matchedTarget?.id ?? selectedTargetId);
        return;
      }
      if (command.includes("push") || command.includes("sync")) {
        await syncToAip();
        return;
      }
      if (command.includes("review")) {
        await reviewTopFinding();
        return;
      }
      if (command.includes("compare") || command.includes("aip")) {
        await askAip(trimmed);
        return;
      }
      addMessage({
        role: "voice-agent",
        text: "Command received. Available actions: analyze target, push to AIP, compare runs, review top finding."
      });
    },
    [addMessage, askAip, reviewTopFinding, runAssessment, selectedTargetId, setActiveMapSurfaceId, syncToAip]
  );

  const toggleLayer = useCallback((layerId: string) => {
    setActiveLayerIds((current) =>
      current.includes(layerId) ? current.filter((id) => id !== layerId) : [...current, layerId]
    );
  }, []);

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
    targets,
    askAip,
    reviewTopFinding,
    runAssessment,
    sendCommand,
    setActiveMapSurfaceId,
    setSelectedTargetId,
    syncToAip,
    toggleLayer
  };
}
