import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function summarizePipecatError(data: unknown, fallback: string): string {
  if (!isJsonRecord(data)) {
    return fallback;
  }

  for (const key of ["error", "detail", "info", "message"]) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }

    if (isJsonRecord(value)) {
      const nested = summarizePipecatError(value, "");
      if (nested) {
        return nested;
      }
    }
  }

  const keys = Object.keys(data);
  return keys.length > 0 ? `Pipecat Cloud rejected the request. Response fields: ${keys.join(", ")}.` : fallback;
}

function normalizeDailyStartResponse(data: unknown) {
  if (!isJsonRecord(data)) {
    return null;
  }

  const dailyRoom =
    isJsonRecord(data.dailyRoom) ? data.dailyRoom
    : isJsonRecord(data.daily_room) ? data.daily_room
    : isJsonRecord(data.room) ? data.room
    : undefined;
  const url =
    getString(data.url) ??
    getString(data.dailyRoom) ??
    getString(data.daily_room) ??
    getString(data.room_url) ??
    getString(dailyRoom?.url) ??
    getString(dailyRoom?.roomUrl) ??
    getString(dailyRoom?.room_url);
  const token =
    getString(data.token) ??
    getString(data.dailyToken) ??
    getString(data.daily_token) ??
    getString(dailyRoom?.token) ??
    getString(dailyRoom?.dailyToken) ??
    getString(dailyRoom?.daily_token);
  const sessionId = getString(data.sessionId) ?? getString(data.session_id);
  const iceConfig = data.iceConfig ?? data.ice_config;

  if (!url) {
    return null;
  }

  return {
    url,
    ...(token ? { token } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(iceConfig ? { iceConfig } : {})
  };
}

function pipecatCloudStartPlugin(mode: string): PluginOption {
  const env = loadEnv(mode, process.cwd(), "");
  const apiKey = env.PIPECAT_CLOUD_API_KEY || env.PCC_PAT || "";
  const agentName = env.PIPECAT_AGENT_NAME || "gradient-bang-bot";
  const apiBase = env.PIPECAT_CLOUD_API_BASE || "https://api.pipecat.daily.co/v1/public";

  return {
    name: "pipecat-cloud-start-endpoint",
    configureServer(server) {
      server.middlewares.use("/api/pipecat/start", async (req, res) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { error: "Method not allowed" });
          return;
        }

        if (!apiKey) {
          sendJson(res, 500, {
            error: "Pipecat Cloud API key is not configured on the dev server."
          });
          return;
        }

        if (apiKey.startsWith("pcc_pat_")) {
          sendJson(res, 401, {
            error: "Pipecat Cloud start authentication is misconfigured.",
            detail:
              "The /start endpoint requires a Pipecat Cloud public API key, not a personal access token. Create or select a public key with `pipecat cloud organizations keys create` or `pipecat cloud organizations keys use`, then put that public key in PIPECAT_CLOUD_API_KEY."
          });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const response = await fetch(`${apiBase.replace(/\/$/, "")}/${agentName}/start`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              createDailyRoom: true,
              dailyRoomProperties: {
                eject_at_room_exp: true,
                start_video_off: true
              },
              transport: "daily",
              body
            })
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            sendJson(res, response.status, {
              error: "Pipecat Cloud session start failed.",
              detail: summarizePipecatError(data, response.statusText || "Pipecat Cloud rejected the session start.")
            });
            return;
          }

          const connectParams = normalizeDailyStartResponse(data);
          if (!connectParams) {
            sendJson(res, 502, {
              error: "Pipecat Cloud session start returned an unexpected response.",
              detail: summarizePipecatError(data, "Missing Daily room URL in Pipecat Cloud response.")
            });
            return;
          }

          sendJson(res, 200, connectParams);
        } catch (error) {
          sendJson(res, 500, {
            error: error instanceof Error ? error.message : "Unknown Pipecat start error"
          });
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => ({
  envPrefix: ["VITE_", "MAPBOX_"],
  plugins: [react(), tailwindcss(), pipecatCloudStartPlugin(mode)],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 5174,
    strictPort: false
  }
}));
