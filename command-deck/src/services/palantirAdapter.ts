import { createMockReport, targets } from "../data/mockMission";
import type { AipSyncReceipt, MissionReport, MissionTarget } from "../domain/types";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export interface PalantirBackend {
  listTargets(): Promise<MissionTarget[]>;
  runAssessment(targetId: string): Promise<MissionReport>;
  syncAssessment(report: MissionReport): Promise<AipSyncReceipt>;
  markFindingReviewed(report: MissionReport, findingId: string): Promise<MissionReport>;
  askAip(report: MissionReport, prompt: string): Promise<string>;
}

export class MockPalantirBackend implements PalantirBackend {
  async listTargets(): Promise<MissionTarget[]> {
    await wait(120);
    return targets;
  }

  async runAssessment(targetId: string): Promise<MissionReport> {
    await wait(640);
    return createMockReport(targetId);
  }

  async syncAssessment(report: MissionReport): Promise<AipSyncReceipt> {
    await wait(760);
    return {
      state: "synced",
      objectRid: `ri.object.main.${report.runId}`,
      actionName: "syncOpsecAnalysisRun",
      operationId: `ri.actions.main.${crypto.randomUUID()}`,
      lastSyncedAt: new Date().toISOString()
    };
  }

  async markFindingReviewed(report: MissionReport, findingId: string): Promise<MissionReport> {
    await wait(280);
    return {
      ...report,
      findings: report.findings.map((finding) =>
        finding.id === findingId ? { ...finding, status: "reviewed" } : finding
      )
    };
  }

  async askAip(report: MissionReport, prompt: string): Promise<string> {
    await wait(420);
    const topFinding = report.findings[0];
    if (prompt.toLowerCase().includes("compare")) {
      return "AIP draft: no prior synced baseline is loaded in the mock adapter. The next backend pass should query AnalysisRun objects linked to this TargetArea.";
    }
    if (topFinding) {
      return `AIP draft: ${report.target.name} has exposure score ${report.score.aggregate}. Highest current review item: ${topFinding.title}.`;
    }
    return "AIP draft: no findings are loaded for the active run.";
  }
}

export const palantirBackend: PalantirBackend = new MockPalantirBackend();
