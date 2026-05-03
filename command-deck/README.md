# OPSEC Command Deck

Gradient-Bang-inspired tactical cockpit for OPSEC Mirror and future Palantir AIP integration.

This project intentionally does **not** port the Gradient Bang game. It borrows the interaction pattern:

- cockpit UI
- bottom conversation bar
- live task stream
- right-side intelligence panels
- Pipecat voice-agent placeholder
- background task-agent model

The Palantir boundary falls back to the mock adapter in `src/services/palantirAdapter.ts`, but it now prefers the Ghostline voice-server bridge from the `forge-voice-agent` clone when `VITE_GHOSTLINE_VOICE_SERVER_URL` is reachable. Typed commands and Pipecat transcripts both route through the same command parser.

## Run

```bash
pnpm install
pnpm dev
```

The dev server defaults to `http://localhost:5174`.

To use live Ghostline/Foundry data, start the voice bridge in the cloned branch first:

```bash
cd ../forge-voice-agent
uvicorn backend.ai.voice_server:app --host 0.0.0.0 --port 8000
```

Then set `VITE_GHOSTLINE_VOICE_SERVER_URL=http://127.0.0.1:8000` in `command-deck/.env`.
