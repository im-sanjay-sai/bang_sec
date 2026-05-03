# Gradient Bang AIP Voice Agent

Pipecat Cloud agent used by the OPSEC command deck. It keeps the Gradient Bang voice pattern and wires a real voice loop:

- Daily room transport
- Deepgram STT
- OpenAI LLM
- Cartesia TTS
- Pipecat RTVI for browser control and transcripts

Required Pipecat Cloud secrets:

```bash
pipecat cloud secrets set command-deck-voice \
  DEEPGRAM_API_KEY=... \
  OPENAI_API_KEY=... \
  CARTESIA_API_KEY=... \
  --skip
```

Optional tuning:

```bash
OPENAI_LLM_MODEL=gpt-4.1-mini
OPENAI_MAX_TOKENS=180
OPENAI_TEMPERATURE=0.4
DEEPGRAM_MODEL=nova-3-general
CARTESIA_MODEL=sonic-3
CARTESIA_VOICE_ID=ec1e269e-9ca0-402f-8a18-58e0e022355a
COMMAND_DECK_AGENT_PROMPT="..."
```

Deploy:

```bash
pipecat cloud deploy --yes --force --secrets command-deck-voice --max-session-duration 300
```

If the secret set is not attached, the bot still connects and sends an RTVI server message explaining which keys are missing, but it cannot perform real speech recognition, LLM response, or speech synthesis.
