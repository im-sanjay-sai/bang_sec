import type { AgentDescriptor, Finding, MapLayer, MissionReport, MissionTarget } from "../domain/types";

export const targets: MissionTarget[] = [
  {
    id: "fort-liberty",
    name: "Fort Liberty",
    lat: 35.1415,
    lon: -79.006,
    radiusKm: 24,
    theater: "CONUS"
  },
  {
    id: "norfolk-naval",
    name: "Norfolk Naval",
    lat: 36.9467,
    lon: -76.3307,
    radiusKm: 18,
    theater: "Atlantic"
  },
  {
    id: "creech-afb",
    name: "Creech AFB",
    lat: 36.5872,
    lon: -115.6733,
    radiusKm: 32,
    theater: "Western Range"
  }
];

export const defaultAgents: AgentDescriptor[] = [
  {
    id: "voice",
    name: "Voice Agent",
    role: "Pipecat operator interface",
    status: "listening",
    currentTask: "Awaiting command"
  },
  {
    id: "fusion",
    name: "Fusion Worker",
    role: "Background task agent",
    status: "idle",
    currentTask: "Collector fan-out"
  },
  {
    id: "aip",
    name: "AIP Sync Worker",
    role: "Palantir adapter",
    status: "idle",
    currentTask: "Ontology writeback"
  }
];

const baseLayers: MapLayer[] = [
  { id: "layer-adsb", source: "adsb", label: "Aerial tracks", visible: true, count: 9, tone: "amber" },
  { id: "layer-exa", source: "exa", label: "Public web hits", visible: true, count: 14, tone: "green" },
  { id: "layer-satellite", source: "satellite", label: "Revisit windows", visible: true, count: 4, tone: "blue" },
  { id: "layer-strava", source: "strava", label: "Movement heat", visible: false, count: 6, tone: "red" }
];

const findingsByTarget: Record<string, Finding[]> = {
  "fort-liberty": [
    {
      id: "fl-adsb-1",
      source: "adsb",
      severity: "high",
      title: "Predictable aerial observation pattern",
      summary: "Repeated public aircraft positions create a recurring observation window near the operating area.",
      evidence: "ADS-B Exchange snapshot",
      lat: 35.154,
      lon: -79.021,
      status: "new"
    },
    {
      id: "fl-exa-1",
      source: "exa",
      severity: "medium",
      title: "Public reporting mentions training tempo",
      summary: "Recent public web results reference exercises and schedule-adjacent language around the installation.",
      evidence: "Public web corpus",
      lat: 35.132,
      lon: -78.987,
      status: "new"
    },
    {
      id: "fl-sat-1",
      source: "satellite",
      severity: "medium",
      title: "Daylight revisit overlap",
      summary: "Mock revisit windows overlap high-activity daytime periods and should be reviewed against actual schedules.",
      evidence: "Synthetic revisit model",
      status: "reviewing"
    },
    {
      id: "fl-strava-1",
      source: "strava",
      severity: "high",
      title: "Movement heat near perimeter roads",
      summary: "Dummy movement heat indicates a repeatable public activity signature near route anchors.",
      evidence: "Mock heatmap tile summary",
      lat: 35.119,
      lon: -79.044,
      status: "new"
    }
  ],
  "norfolk-naval": [
    {
      id: "nn-adsb-1",
      source: "adsb",
      severity: "medium",
      title: "Dense public air traffic context",
      summary: "High ambient traffic makes correlation harder, but several low-altitude tracks require review.",
      evidence: "ADS-B Exchange snapshot",
      lat: 36.958,
      lon: -76.319,
      status: "new"
    },
    {
      id: "nn-exa-1",
      source: "exa",
      severity: "high",
      title: "Port-adjacent public activity cluster",
      summary: "Open reporting and public references cluster near logistics corridors.",
      evidence: "Public web corpus",
      status: "reviewing"
    },
    {
      id: "nn-sat-1",
      source: "satellite",
      severity: "medium",
      title: "Waterfront infrastructure revisit",
      summary: "Mock revisit estimates indicate repeated daylight collection opportunity over key infrastructure.",
      evidence: "Synthetic revisit model",
      lat: 36.944,
      lon: -76.342,
      status: "new"
    }
  ],
  "creech-afb": [
    {
      id: "ca-exa-1",
      source: "exa",
      severity: "medium",
      title: "Sparse but specific public references",
      summary: "Public web hits are fewer but contain specific facility and access-route language.",
      evidence: "Public web corpus",
      status: "new"
    },
    {
      id: "ca-sat-1",
      source: "satellite",
      severity: "high",
      title: "Clear-sky revisit concentration",
      summary: "Dummy weather and revisit assumptions create a stronger aerial collection window.",
      evidence: "Synthetic revisit model",
      lat: 36.586,
      lon: -115.677,
      status: "new"
    },
    {
      id: "ca-strava-1",
      source: "strava",
      severity: "medium",
      title: "Route-edge heat signature",
      summary: "Mock movement heat suggests recurring activity along an approach route.",
      evidence: "Mock heatmap tile summary",
      lat: 36.593,
      lon: -115.649,
      status: "new"
    }
  ]
};

export function createMockReport(targetId: string): MissionReport {
  const target = targets.find((item) => item.id === targetId) ?? targets[0];
  const findings = findingsByTarget[target.id] ?? findingsByTarget["fort-liberty"];
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const mediumCount = findings.filter((finding) => finding.severity === "medium").length;
  const aggregate = Math.min(92, 42 + highCount * 17 + mediumCount * 8);

  return {
    runId: `run-${target.id}-${Date.now().toString(36)}`,
    target,
    generatedAt: new Date().toISOString(),
    mode: "demo",
    score: {
      aggregate,
      movement: target.id === "fort-liberty" ? 78 : 55,
      personnel: target.id === "norfolk-naval" ? 66 : 48,
      facility: target.id === "creech-afb" ? 74 : 61,
      aerial: target.id === "fort-liberty" ? 82 : 69
    },
    findings,
    layers: baseLayers.map((layer) => ({
      ...layer,
      count: Math.max(1, layer.count - (target.id === "creech-afb" ? 4 : 0))
    })),
    narrative:
      `${target.name} shows a defensible but non-trivial public exposure profile. ` +
      "The strongest signals are repeatability, public context around operational tempo, and collection-window overlap. " +
      "The command review should focus on reducing predictable signatures, validating public-source assumptions, and documenting human decisions in the ontology.",
    mitigationPriorities: [
      "Review public movement signatures near route anchors.",
      "Validate public aircraft tracks against operational schedules.",
      "Stage high-severity findings for human review before action.",
      "Sync assessment, evidence, and review state into Palantir AIP."
    ],
    aip: {
      state: "not_synced"
    }
  };
}
