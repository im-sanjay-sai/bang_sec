# Voice Agent Integration Notes

Date: 2026-05-03

## What It Does

The command deck now has a browser-to-voice-agent control loop:

- The React command deck starts a Pipecat Cloud session through the local Vite endpoint `/api/pipecat/start`.
- The Pipecat bot joins the generated Daily room and runs Deepgram STT, OpenAI LLM, and a configurable TTS provider.
- The bot emits structured RTVI server messages for deck actions instead of relying only on transcript text.
- The browser normalizes those messages through `voiceDeckProtocol`, executes the requested deck action, and sends a structured action result back to the bot.
- Typed commands and voice commands share the same command deck action path where possible.

Supported voice-directed deck actions include:

- Set active location.
- Run an assessment.
- Sync the active assessment to the AIP adapter.
- Review the top finding.
- Ask the AIP/Ghostline context path a question.
- Toggle data layers.
- Change map visual mode.
- Read current deck state.

The deck also prefers the Ghostline voice-server API when it is reachable:

- `GET /voice/get_full_picture`
- `GET /voice/compare_locations`
- `GET /voice/recommend_mitigations`
- `GET /voice/get_current_state`

If Ghostline or Foundry is not configured, the UI falls back to the local mock Palantir adapter so the demo still runs.

## Runtime Pieces

Local command deck:

```bash
cd command-deck
pnpm dev
```

Pipecat Cloud bot:

```bash
cd pipecat-dummy-agent
pipecat cloud deploy --yes --force --secrets command-deck-voice --max-session-duration 300 --region us-west
```

Ghostline voice bridge:

```bash
cd forge-voice-agent
python -m uvicorn backend.ai.voice_server:app --host 127.0.0.1 --port 8000
```

Required secret names:

```bash
DEEPGRAM_API_KEY
OPENAI_API_KEY
CARTESIA_API_KEY
VOICE_TTS_PROVIDER
GHOSTLINE_VOICE_SERVER_URL
```

The deployed bot currently uses:

```bash
VOICE_TTS_PROVIDER=openai
```

That setting avoids the Cartesia websocket failure seen during testing.

## Key Files

- `command-deck/src/components/ConversationBar.tsx`: starts the Pipecat session, tracks RTVI phases, receives bot messages, and returns action results.
- `command-deck/src/services/voiceDeckProtocol.ts`: shared browser-side protocol for voice actions, action results, deck state, and map-mode normalization.
- `command-deck/src/hooks/useCommandDeck.ts`: routes structured voice actions into the existing deck state machine.
- `command-deck/src/services/ghostlineVoiceAdapter.ts`: calls the Ghostline FastAPI endpoints and converts responses into `MissionReport` data.
- `command-deck/vite.config.ts`: exposes the local `/api/pipecat/start` endpoint and forwards session starts to Pipecat Cloud.
- `pipecat-dummy-agent/bot.py`: registers the voice tools, sends structured deck actions, and chooses Cartesia or OpenAI TTS from env.

## What We Learned

The Pipecat server was reachable. The local start endpoint returned valid Daily room credentials, the org resolved, and the bot joined Daily successfully.

The real failure was downstream TTS:

```text
CartesiaTTSService exception: server rejected WebSocket connection: HTTP 402
```

That means the connection path was healthy, but the Cartesia account/key could not synthesize audio. Switching the bot to OpenAI TTS fixed the runtime path without changing the browser client.

Useful debugging checks:

```bash
pipecat cloud organizations list
pipecat cloud regions list
pipecat cloud agent status gradient-bang-bot
pipecat cloud agent sessions gradient-bang-bot
pipecat cloud agent logs gradient-bang-bot --limit 120 --level ERROR
```

A successful `/api/pipecat/start` response proves the Vite endpoint and Pipecat Cloud public key are working. It does not prove STT, LLM, or TTS are healthy; those must be confirmed in agent logs.

The cloud agent is configured with `max_agents=2`, so probe sessions can exhaust capacity. Stop probe sessions after testing:

```bash
pipecat cloud agent stop gradient-bang-bot --session-id <session-id> --force
```

Vite env changes need a dev-server restart. Mapbox works through either `VITE_MAPBOX_TOKEN` or `MAPBOX_TOKEN`, but `MAPBOX_TOKEN` requires `envPrefix` support in Vite.

Never commit or print raw provider keys. Only commit env variable names and setup instructions.
