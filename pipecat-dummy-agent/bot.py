#
# Pipecat Cloud voice agent for the OPSEC command deck.
#

import os
import uuid
from typing import Any, Mapping

from dotenv import load_dotenv
from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    Frame,
    TTSSpeakFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pipecat.runner.types import DailyRunnerArguments, RunnerArguments
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.deepgram.stt import DeepgramSTTService, LiveOptions
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.tts import OpenAITTSService
from pipecat.transcriptions.language import Language
from pipecat.transports.daily.transport import DailyParams, DailyTransport
from pipecat.turns.user_mute.base_user_mute_strategy import BaseUserMuteStrategy

load_dotenv(override=True)

DEFAULT_CARTESIA_VOICE_ID = "ec1e269e-9ca0-402f-8a18-58e0e022355a"
BASE_REQUIRED_VOICE_KEYS = ("DEEPGRAM_API_KEY", "OPENAI_API_KEY")
VAD_PARAMS = VADParams(confidence=0.65, start_secs=0.15, stop_secs=0.35, min_volume=0.55)
DECK_ACTION_MESSAGE_TYPE = "command-deck.action"

KNOWN_LOCATIONS = {
    "fort-liberty": {
        "label": "Fort Liberty",
        "aliases": ("fort liberty", "liberty", "ft liberty", "fort bragg", "bragg"),
    },
    "norfolk-naval": {
        "label": "Norfolk Naval",
        "aliases": ("norfolk naval", "norfolk", "naval station norfolk", "naval"),
    },
    "creech-afb": {
        "label": "Creech AFB",
        "aliases": ("creech afb", "creech", "creech air force base", "air force base creech"),
    },
}

SET_ACTIVE_LOCATION_TOOL = FunctionSchema(
    name="set_active_location",
    description=(
        "Move the command-deck map to a location. Use this whenever the operator asks "
        "to show, open, focus, switch, change location, go to, analyze, or asks about one "
        "of the known locations or any other place name."
    ),
    properties={
        "location_id": {
            "type": "string",
            "enum": list(KNOWN_LOCATIONS.keys()),
            "description": "Optional known command-deck location id when the place is one of the known targets.",
        },
        "location_name": {
            "type": "string",
            "description": "The exact location or place name the operator asked about.",
        },
        "spoken_reference": {
            "type": "string",
            "description": "Optional exact phrase the operator used for the location.",
        },
    },
    required=["location_name"],
)

RUN_ASSESSMENT_TOOL = FunctionSchema(
    name="run_assessment",
    description="Run the command-deck assessment workflow. Use this for analyze, assess, run scan, or start review requests.",
    properties={
        "location_name": {
            "type": "string",
            "description": "Optional location or target name to assess. Leave empty to use the active deck target.",
        },
        "spoken_reference": {
            "type": "string",
            "description": "Optional exact phrase the operator used for the location.",
        },
    },
    required=[],
)

SYNC_TO_AIP_TOOL = FunctionSchema(
    name="sync_to_aip",
    description="Push or sync the active assessment package to the command deck's AIP adapter.",
    properties={},
    required=[],
)

REVIEW_TOP_FINDING_TOOL = FunctionSchema(
    name="review_top_finding",
    description="Mark the top active finding reviewed when the operator says review, mark reviewed, or clear top finding.",
    properties={},
    required=[],
)

ASK_AIP_TOOL = FunctionSchema(
    name="ask_aip",
    description="Route a commander's question through the deck AIP query path.",
    properties={
        "prompt": {
            "type": "string",
            "description": "The concise question or instruction to ask against the active assessment.",
        },
    },
    required=["prompt"],
)

SET_MAP_MODE_TOOL = FunctionSchema(
    name="set_map_mode",
    description="Change the command-deck map visual mode.",
    properties={
        "map_mode": {
            "type": "string",
            "enum": ["dark", "satellite", "terrain", "urban3d"],
            "description": "The requested map mode.",
        },
    },
    required=["map_mode"],
)

TOGGLE_LAYER_TOOL = FunctionSchema(
    name="toggle_layer",
    description="Toggle a visible command-deck data layer.",
    properties={
        "layer_id": {
            "type": "string",
            "enum": ["layer-adsb", "layer-exa", "layer-satellite", "layer-strava"],
            "description": "The deck layer id.",
        },
        "layer_label": {
            "type": "string",
            "description": "Optional spoken label for the layer.",
        },
    },
    required=["layer_id"],
)

GET_DECK_STATE_TOOL = FunctionSchema(
    name="get_deck_state",
    description="Ask the browser command deck to report its current active target, score, layers, and agent state.",
    properties={},
    required=[],
)

SYSTEM_PROMPT = """You are the command voice inside a Gradient Bang-style Palantir AIP cockpit.
You help the operator triage live mission data, background agent tasks, and hackathon build work.
Keep spoken answers short, operational, and specific. Never claim you can access Palantir,
Pipecat, or external systems unless tool context or the operator explicitly provides it.

The browser command deck has a system agent, voice agent, fusion worker, and AIP sync worker.
For deck control, call tools. Do not rely on the browser parsing raw transcripts.

Known command-deck locations:
- fort-liberty: Fort Liberty
- norfolk-naval: Norfolk Naval
- creech-afb: Creech AFB

When the operator asks to show, open, focus, switch, move to, change location,
analyze, or asks about a location, call set_active_location with location_name.
Use location_id too only when the place matches a known command-deck location.
When the operator asks to analyze or assess, call run_assessment.
When the operator asks to push or sync, call sync_to_aip.
When the operator asks to review the top finding, call review_top_finding.
When the operator asks about AIP, comparison, status, or findings, call ask_aip or get_deck_state.
When the operator asks for satellite, terrain, dark, or 3D view, call set_map_mode.
When the operator asks to show or hide a layer, call toggle_layer."""

READY_GREETING = (
    "Voice link online. I can hear you now. Give me a command for the AIP operations deck."
)


class FirstBotSpeechMuteStrategy(BaseUserMuteStrategy):
    """Mute user audio until the first bot utterance completes.

    This mirrors Gradient Bang's startup guard. It prevents the bot's own
    greeting or speaker echo from being treated as the first user turn.
    """

    def __init__(self):
        super().__init__()
        self._first_speech_finished = False

    async def process_frame(self, frame: Frame) -> bool:
        await super().process_frame(frame)

        if isinstance(frame, BotStoppedSpeakingFrame):
            self._first_speech_finished = True

        return not self._first_speech_finished


def _missing_voice_keys() -> list[str]:
    required = list(BASE_REQUIRED_VOICE_KEYS)
    if os.getenv("VOICE_TTS_PROVIDER", "cartesia").lower() == "cartesia":
        required.append("CARTESIA_API_KEY")
    return [key for key in required if not os.getenv(key)]


def _build_tts_service():
    provider = os.getenv("VOICE_TTS_PROVIDER", "cartesia").lower()
    if provider == "openai":
        logger.info("Using OpenAI TTS provider")
        return OpenAITTSService(
            api_key=os.environ["OPENAI_API_KEY"],
            voice=os.getenv("OPENAI_TTS_VOICE", "alloy"),
            model=os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        )

    logger.info("Using Cartesia TTS provider")
    return CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id=os.getenv("CARTESIA_VOICE_ID", DEFAULT_CARTESIA_VOICE_ID),
        model=os.getenv("CARTESIA_MODEL", "sonic-3"),
    )


def _normalize_location_text(text: str) -> str:
    return " ".join("".join(char.lower() if char.isalnum() else " " for char in text).split())


def _string_arg(arguments: Mapping[str, Any], key: str) -> str | None:
    value = arguments.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _resolve_location(arguments: Mapping[str, Any]) -> tuple[str, str] | None:
    location_id = _string_arg(arguments, "location_id")
    if location_id in KNOWN_LOCATIONS:
        return location_id, KNOWN_LOCATIONS[location_id]["label"]

    search_text = " ".join(
        value
        for key in ("location_name", "spoken_reference", "location", "target", "query")
        if (value := _string_arg(arguments, key))
    )
    normalized = _normalize_location_text(search_text)
    if not normalized:
        return None

    for candidate_id, definition in KNOWN_LOCATIONS.items():
        aliases = (definition["label"], *definition["aliases"])
        if any(_normalize_location_text(alias) in normalized for alias in aliases):
            return candidate_id, definition["label"]

    return None


def _extract_location_name(arguments: Mapping[str, Any]) -> str | None:
    for key in ("location_name", "spoken_reference", "location", "target", "query"):
        value = _string_arg(arguments, key)
        if value:
            return value

    return None


def _deck_request_id() -> str:
    return f"voice-{uuid.uuid4().hex[:10]}"


async def _send_deck_action(rtvi: RTVIProcessor, params: FunctionCallParams, action: str, text: str, **payload: Any):
    request_id = _deck_request_id()
    message = {
        "type": DECK_ACTION_MESSAGE_TYPE,
        "requestId": request_id,
        "action": action,
        "text": text,
        **{key: value for key, value in payload.items() if value is not None},
    }
    await rtvi.send_server_message(message)
    await params.result_callback(
        {
            "success": True,
            "requestId": request_id,
            "action": action,
            "message": text,
        }
    )


def _make_set_active_location_handler(rtvi: RTVIProcessor):
    async def handle_set_active_location(params: FunctionCallParams):
        location = _resolve_location(params.arguments)
        location_name = _extract_location_name(params.arguments)

        if location:
            location_id, label = location
            await _send_deck_action(
                rtvi,
                params,
                "set_location",
                f"Moving map to {label}.",
                surfaceId=location_id,
                targetId=location_id,
                locationName=label,
            )
            return

        if location_name:
            await _send_deck_action(
                rtvi,
                params,
                "set_location",
                f"Looking up {location_name}.",
                locationName=location_name,
            )
            return

        await params.result_callback(
            {
                "success": False,
                "error": "No location name was provided.",
                "known_location_ids": list(KNOWN_LOCATIONS.keys()),
            }
        )

    return handle_set_active_location


def _make_run_assessment_handler(rtvi: RTVIProcessor):
    async def handle_run_assessment(params: FunctionCallParams):
        location = _resolve_location(params.arguments)
        location_name = _extract_location_name(params.arguments)
        surface_id = location[0] if location else None
        label = location[1] if location else location_name
        await _send_deck_action(
            rtvi,
            params,
            "run_assessment",
            f"Running assessment{f' for {label}' if label else ''}.",
            surfaceId=surface_id,
            targetId=surface_id,
            locationName=label,
        )

    return handle_run_assessment


def _make_sync_to_aip_handler(rtvi: RTVIProcessor):
    async def handle_sync_to_aip(params: FunctionCallParams):
        await _send_deck_action(rtvi, params, "sync_to_aip", "Syncing active assessment to AIP.")

    return handle_sync_to_aip


def _make_review_top_finding_handler(rtvi: RTVIProcessor):
    async def handle_review_top_finding(params: FunctionCallParams):
        await _send_deck_action(rtvi, params, "review_top_finding", "Reviewing top finding.")

    return handle_review_top_finding


def _make_ask_aip_handler(rtvi: RTVIProcessor):
    async def handle_ask_aip(params: FunctionCallParams):
        prompt = _string_arg(params.arguments, "prompt") or "Summarize the active assessment."
        await _send_deck_action(rtvi, params, "ask_aip", "Querying AIP context.", prompt=prompt)

    return handle_ask_aip


def _make_set_map_mode_handler(rtvi: RTVIProcessor):
    async def handle_set_map_mode(params: FunctionCallParams):
        map_mode = _string_arg(params.arguments, "map_mode") or _string_arg(params.arguments, "mode")
        await _send_deck_action(rtvi, params, "set_map_mode", f"Setting map mode to {map_mode}.", mapMode=map_mode)

    return handle_set_map_mode


def _make_toggle_layer_handler(rtvi: RTVIProcessor):
    async def handle_toggle_layer(params: FunctionCallParams):
        layer_id = _string_arg(params.arguments, "layer_id")
        layer_label = _string_arg(params.arguments, "layer_label")
        await _send_deck_action(
            rtvi,
            params,
            "toggle_layer",
            f"Toggling {layer_label or layer_id or 'requested layer'}.",
            layerId=layer_id,
            layerLabel=layer_label,
        )

    return handle_toggle_layer


def _make_get_deck_state_handler(rtvi: RTVIProcessor):
    async def handle_get_deck_state(params: FunctionCallParams):
        await _send_deck_action(rtvi, params, "get_deck_state", "Reading command deck state.")

    return handle_get_deck_state


def _build_voice_pipeline(transport: DailyTransport, rtvi: RTVIProcessor) -> Pipeline:
    missing = _missing_voice_keys()
    if missing:
        raise RuntimeError(
            "Voice providers are not configured. Missing Pipecat Cloud secrets: "
            + ", ".join(missing)
            + "."
        )

    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        live_options=LiveOptions(
            language=Language.EN,
            model=os.getenv("DEEPGRAM_MODEL", "nova-3-general"),
            smart_format=True,
            interim_results=True,
        ),
    )
    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        settings=OpenAILLMService.Settings(
            model=os.getenv("OPENAI_LLM_MODEL", os.getenv("OPENAI_MODEL", "gpt-4.1-mini")),
            temperature=float(os.getenv("OPENAI_TEMPERATURE", "0.4")),
            max_tokens=int(os.getenv("OPENAI_MAX_TOKENS", "180")),
        ),
    )
    llm.register_function("set_active_location", _make_set_active_location_handler(rtvi))
    llm.register_function("run_assessment", _make_run_assessment_handler(rtvi))
    llm.register_function("sync_to_aip", _make_sync_to_aip_handler(rtvi))
    llm.register_function("review_top_finding", _make_review_top_finding_handler(rtvi))
    llm.register_function("ask_aip", _make_ask_aip_handler(rtvi))
    llm.register_function("set_map_mode", _make_set_map_mode_handler(rtvi))
    llm.register_function("toggle_layer", _make_toggle_layer_handler(rtvi))
    llm.register_function("get_deck_state", _make_get_deck_state_handler(rtvi))
    tts = _build_tts_service()

    context = LLMContext(
        messages=[
            {
                "role": "system",
                "content": os.getenv("COMMAND_DECK_AGENT_PROMPT", SYSTEM_PROMPT),
            }
        ],
        tools=ToolsSchema(
            standard_tools=[
                SET_ACTIVE_LOCATION_TOOL,
                RUN_ASSESSMENT_TOOL,
                SYNC_TO_AIP_TOOL,
                REVIEW_TOP_FINDING_TOOL,
                ASK_AIP_TOOL,
                SET_MAP_MODE_TOOL,
                TOGGLE_LAYER_TOOL,
                GET_DECK_STATE_TOOL,
            ]
        ),
    )
    startup_mute = FirstBotSpeechMuteStrategy()
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(params=VAD_PARAMS),
            user_mute_strategies=[startup_mute],
            user_turn_stop_timeout=1.2,
            audio_idle_timeout=0.6,
        ),
    )
    if hasattr(user_aggregator, "_user_is_muted"):
        user_aggregator._user_is_muted = True

    return Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )


def _build_unconfigured_pipeline(transport: DailyTransport) -> Pipeline:
    return Pipeline(
        [
            transport.input(),
            transport.output(),
        ]
    )


async def run_bot(transport):
    """Run an RTVI-compatible Daily voice pipeline."""
    voice_config_error = None
    rtvi = RTVIProcessor(transport=transport)
    try:
        pipeline = _build_voice_pipeline(transport, rtvi)
        logger.info("Command-deck voice pipeline configured with STT, LLM, and TTS")
    except RuntimeError as error:
        voice_config_error = str(error)
        pipeline = _build_unconfigured_pipeline(transport)
        logger.warning(voice_config_error)

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
        rtvi_processor=rtvi,
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Command-deck client connected")

    @task.rtvi.event_handler("on_client_ready")
    async def on_client_ready(rtvi):
        if voice_config_error:
            await rtvi.send_server_message(
                {
                    "type": "command-deck.voice-config-missing",
                    "text": voice_config_error,
                }
            )
            return

        await rtvi.send_server_message(
            {
                "type": "command-deck.voice-ready",
                "text": READY_GREETING,
            }
        )
        await task.queue_frame(TTSSpeakFrame(text=READY_GREETING, append_to_context=False))

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Command-deck client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=False)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Pipecat Cloud entry point."""
    match runner_args:
        case DailyRunnerArguments():
            transport = DailyTransport(
                runner_args.room_url,
                runner_args.token,
                "Gradient Bang AIP",
                params=DailyParams(
                    audio_in_enabled=True,
                    audio_out_enabled=True,
                ),
            )
        case _:
            logger.error(f"Unsupported runner arguments type: {type(runner_args)}")
            return

    await run_bot(transport)


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()
