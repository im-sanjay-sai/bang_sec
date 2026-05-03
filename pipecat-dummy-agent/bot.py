#
# Pipecat Cloud voice agent for the OPSEC command deck.
#

import os

from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import TTSSpeakFrame
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
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transcriptions.language import Language
from pipecat.transports.daily.transport import DailyParams, DailyTransport

load_dotenv(override=True)

DEFAULT_CARTESIA_VOICE_ID = "ec1e269e-9ca0-402f-8a18-58e0e022355a"
REQUIRED_VOICE_KEYS = ("DEEPGRAM_API_KEY", "OPENAI_API_KEY", "CARTESIA_API_KEY")

SYSTEM_PROMPT = """You are the command voice inside a Gradient Bang-style Palantir AIP cockpit.
You help the operator triage live mission data, background agent tasks, and hackathon build work.
Keep spoken answers short, operational, and specific. Never claim you can access Palantir,
Pipecat, or external systems unless tool context or the operator explicitly provides it."""

READY_GREETING = (
    "Voice link online. I can hear you now. Give me a command for the AIP operations deck."
)


def _missing_voice_keys() -> list[str]:
    return [key for key in REQUIRED_VOICE_KEYS if not os.getenv(key)]


def _build_voice_pipeline(transport: DailyTransport) -> Pipeline:
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
    tts = CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id=os.getenv("CARTESIA_VOICE_ID", DEFAULT_CARTESIA_VOICE_ID),
        model=os.getenv("CARTESIA_MODEL", "sonic-3"),
    )

    context = LLMContext(
        messages=[
            {
                "role": "system",
                "content": os.getenv("COMMAND_DECK_AGENT_PROMPT", SYSTEM_PROMPT),
            }
        ]
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
            user_turn_stop_timeout=4.0,
        ),
    )

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
    try:
        pipeline = _build_voice_pipeline(transport)
        logger.info("Command-deck voice pipeline configured with STT, LLM, and TTS")
    except RuntimeError as error:
        voice_config_error = str(error)
        pipeline = _build_unconfigured_pipeline(transport)
        logger.warning(voice_config_error)

    rtvi = RTVIProcessor(transport=transport)
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
