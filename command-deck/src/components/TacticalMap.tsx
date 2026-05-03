import { CrosshairIcon, MapPinIcon, NavigationArrowIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";

import radialGrad from "../assets/images/radial-grad-md.png";
import skybox from "../assets/images/skybox-4.png";
import type { MissionReport, MissionTarget } from "../domain/types";
import { PanelTitle } from "./PanelTitle";
import { Badge } from "./primitives/Badge";
import { Divider } from "./primitives/Divider";

interface TacticalMapProps {
  activeLayerIds: string[];
  report: MissionReport | null;
  target: MissionTarget;
}

const toneClass = {
  amber: "border-warning text-warning",
  blue: "border-fuel text-fuel",
  green: "border-success text-success",
  red: "border-destructive text-destructive",
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function pinPosition(finding: NonNullable<MissionReport["findings"]>[number], target: MissionTarget, index: number) {
  if (typeof finding.lat !== "number" || typeof finding.lon !== "number") {
    return {
      left: 24 + ((index * 17) % 52),
      top: 26 + ((index * 23) % 42),
    };
  }

  const kmPerDegree = 111;
  const xKm = (finding.lon - target.lon) * kmPerDegree * Math.cos((target.lat * Math.PI) / 180);
  const yKm = (target.lat - finding.lat) * kmPerDegree;
  const scale = target.radiusKm || 1;

  return {
    left: clamp(50 + (xKm / scale) * 34, 12, 88),
    top: clamp(50 + (yKm / scale) * 34, 14, 86),
  };
}

export function TacticalMap({ activeLayerIds, report, target }: TacticalMapProps) {
  const layers = report?.layers ?? [];
  const activeLayers = layers.filter((layer) => activeLayerIds.includes(layer.id));
  const findings = report?.findings ?? [];
  const pins = findings.map((finding, index) => ({
    finding,
    position: pinPosition(finding, target, index),
  }));

  return (
    <section className="absolute inset-0 isolate overflow-hidden bg-black">
      <img src={skybox} alt="" className="absolute inset-0 h-full w-full scale-105 object-cover opacity-45 saturate-0" />
      <div className="absolute inset-0 command-map-grid opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgb(0_0_0_/_0.08)_38%,rgb(0_0_0_/_0.88)_100%)]" />
      <div
        className="absolute left-1/2 top-1/2 size-[34rem] max-h-[92%] max-w-[92%] -translate-x-1/2 -translate-y-1/2 opacity-45 mix-blend-screen"
        style={{ backgroundImage: `url(${radialGrad})`, backgroundSize: "100% 100%" }}
      />

      <svg className="absolute inset-0 h-full w-full text-border" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <circle cx="50" cy="50" r="10" fill="none" stroke="currentColor" strokeWidth="0.16" opacity="0.8" />
        <circle cx="50" cy="50" r="21" fill="none" stroke="currentColor" strokeWidth="0.14" opacity="0.7" />
        <circle cx="50" cy="50" r="35" fill="none" stroke="currentColor" strokeWidth="0.12" opacity="0.55" />
        <circle cx="50" cy="50" r="49" fill="none" stroke="currentColor" strokeWidth="0.1" opacity="0.38" />
        {pins.map(({ finding, position }) => (
          <line
            key={`lane-${finding.id}`}
            x1="50"
            y1="50"
            x2={position.left}
            y2={position.top}
            stroke="currentColor"
            strokeWidth="0.13"
            strokeDasharray="1.1 0.9"
            opacity="0.65"
          />
        ))}
      </svg>

      <aside className="absolute left-0 top-ui-sm z-20 hidden w-72 flex-row gap-ui-sm border border-l-0 border-border bg-background/90 p-ui-sm shadow-long shadow-black/25 @2xl/main:flex">
        <Divider orientation="vertical" variant="dashed" className="h-auto w-3 self-stretch text-accent" />
        <div className="min-w-0 flex-1">
          <PanelTitle>Sector {target.theater}</PanelTitle>
          <dl className="mt-ui-xs grid gap-2 text-[10px] uppercase">
            <Readout label="Target" value={target.name} />
            <Readout label="Radius" value={`${target.radiusKm} km`} />
            <Readout label="Layers" value={`${activeLayers.length}/${layers.length || 4} active`} />
            <Readout label="Findings" value={`${findings.length || 0} staged`} />
          </dl>
        </div>
      </aside>

      <div className="absolute right-ui-sm top-ui-sm z-20 hidden flex-col gap-ui-xs @2xl/main:flex">
        {activeLayers.map((layer) => (
          <Badge
            key={layer.id}
            border="elbow"
            size="sm"
            variant="secondary"
            className={`justify-start bg-black/70 font-mono ${toneClass[layer.tone]}`}
          >
            <span className="w-24 truncate">{layer.label}</span>
            <span className="text-white/60">{layer.count}</span>
          </Badge>
        ))}
      </div>

      <div className="absolute left-1/2 top-1/2 z-10 grid -translate-x-1/2 -translate-y-1/2 place-items-center">
        <div className="relative grid size-24 place-items-center border border-terminal/50 bg-terminal-background/20 text-terminal bracket bracket-terminal bracket-offset-2 bracket-size-8">
          <div className="absolute inset-4 rounded-full border border-terminal/30" />
          <CrosshairIcon size={44} weight="bold" className="animate-pulse" />
        </div>
        <Badge variant="highlight" border="bracket" className="mt-ui-xs max-w-[70vw] bg-black/80">
          <span className="truncate">{target.name}</span>
        </Badge>
      </div>

      {pins.map(({ finding, position }) => (
        <button
          className={[
            "absolute z-20 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center border bg-black/80 bracket bracket-offset-1 bracket-size-4 transition-transform hover:scale-110",
            finding.severity === "high" || finding.severity === "critical"
              ? "border-destructive text-destructive bracket-destructive"
              : finding.severity === "medium"
                ? "border-warning text-warning bracket-warning"
                : "border-success text-success bracket-success",
          ].join(" ")}
          key={finding.id}
          style={
            {
              left: `${position.left}%`,
              top: `${position.top}%`,
            } as CSSProperties
          }
          title={finding.title}
          type="button"
        >
          <MapPinIcon size={16} weight="fill" />
        </button>
      ))}

      <div className="absolute bottom-ui-xs left-ui-xs z-10 hidden items-center gap-ui-xs bg-background/50 px-ui-xs py-ui-xxs font-mono text-[10px] uppercase text-muted-foreground @2xl/main:flex">
        <NavigationArrowIcon size={13} className="text-terminal" weight="bold" />
        <span className="h-px w-16 bg-border" />
        <span>10 km</span>
      </div>

      <div className="absolute bottom-ui-xs right-ui-xs z-10 flex max-w-[calc(100%_-_16px)] flex-wrap justify-end gap-ui-xxs">
        <Badge variant="ghost" size="sm" className="bg-background/60 font-mono">
          {target.lat.toFixed(4)}
        </Badge>
        <Badge variant="ghost" size="sm" className="bg-background/60 font-mono">
          {target.lon.toFixed(4)}
        </Badge>
        <Badge variant={findings.some((finding) => finding.severity === "high" || finding.severity === "critical") ? "warning" : "success"} size="sm">
          {findings.length || "No"} findings
        </Badge>
      </div>
    </section>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-ui-xs">
      <dt className="font-bold text-white">{label}</dt>
      <dd className="truncate text-muted-foreground">{value}</dd>
    </div>
  );
}
