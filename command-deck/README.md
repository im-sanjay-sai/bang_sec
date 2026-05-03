# OPSEC Command Deck

Gradient-Bang-inspired tactical cockpit for OPSEC Mirror and future Palantir AIP integration.

This project intentionally does **not** port the Gradient Bang game. It borrows the interaction pattern:

- cockpit UI
- bottom conversation bar
- live task stream
- right-side intelligence panels
- Pipecat voice-agent placeholder
- background task-agent model

The Palantir boundary is currently mocked in `src/services/palantirAdapter.ts`. Replace that adapter later with OSDK reads/writes, Apply Action calls, or AIP Chatbot/Logic function endpoints.

## Run

```bash
pnpm install
pnpm dev
```

The dev server defaults to `http://localhost:5174`.
