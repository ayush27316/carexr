#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Pipecat Voice AI Bot with WebSocket transport.

Runs a FastAPI server with a /ws WebSocket endpoint that clients
connect to for real-time voice conversations. Supports voice-driven
3D asset generation via Meshy AI tool calling.

Required AI services:
- Deepgram (Speech-to-Text)
- Cerebras (LLM — Qwen 3 235B Instruct)
- Cartesia (Text-to-Speech)
- Meshy AI (3D generation, via tool call)

Run the bot using::

    uvicorn server:app --host 0.0.0.0 --port 8765
"""

import asyncio
import os
import re

from dotenv import load_dotenv
from loguru import logger

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import Frame, LLMRunFrame, TextFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import RunnerArguments
from pipecat.serializers.protobuf import ProtobufFrameSerializer
from pipecat.services.cartesia.tts import CartesiaTTSService
from pipecat.services.cerebras.llm import CerebrasLLMService
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

from meshy import generate_3d_object

load_dotenv(override=True)

_TAG_RE = re.compile(r"\[(?:face|animation):(\w+)\]")


class ExpressionFilter(FrameProcessor):
    """Strips [face:name] and [animation:name] tags from TextFrames.

    Tags are left in the conversation context (so the LLM sees them) but
    removed before TTS so they aren't spoken aloud.  Handles tags split
    across chunked frames by buffering partial matches.

    When a tag is found, an ExpressionFrame is pushed downstream so the
    transport serializer can forward it to the client.
    """

    def __init__(self):
        super().__init__()
        self._buf = ""

    async def _flush(self):
        """Extract expression tags, emit ExpressionFrames, then push cleaned text."""
        from lens_serializer import ExpressionFrame

        for match in _TAG_RE.finditer(self._buf):
            await self.push_frame(ExpressionFrame(expression_name=match.group(1)))

        cleaned = _TAG_RE.sub("", self._buf)
        self._buf = ""
        if cleaned:
            await self.push_frame(TextFrame(text=cleaned))

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TextFrame):
            self._buf += frame.text
            if "[" in self._buf and "]" not in self._buf.split("[")[-1]:
                return
            await self._flush()
        else:
            if self._buf:
                await self._flush()
            await self.push_frame(frame, direction)


async def run_bot(transport: BaseTransport, handle_sigint: bool):
    logger.info("Starting bot pipeline")

    stt = DeepgramSTTService(api_key=os.getenv("DEEPGRAM_API_KEY"))

    tts = CartesiaTTSService(
        api_key=os.getenv("CARTESIA_API_KEY"),
        settings=CartesiaTTSService.Settings(
            voice="71a7ad14-091c-4e8e-a314-022ece01c121",  # British Reading Lady
        ),
    )

    llm = CerebrasLLMService(
        api_key=os.getenv("CEREBRAS_API_KEY"),
        settings=CerebrasLLMService.Settings(
            model="qwen-3-235b-a22b-instruct-2507",
            temperature=0.7,
            max_completion_tokens=1024,
            system_instruction=(
                "You are a magical creative buddy who helps kids build anything they can imagine! "
                "You live inside this screen and your superpower is turning ideas into real 3D things. "
                "Talk like a warm, excited friend — simple words, short sentences, lots of energy. "
                "Match the kid's enthusiasm. If they say 'a dragon!' you say 'Ooh a dragon, awesome!' "
                "not 'I will now generate a 3D model of a dragon.'\n\n"
                "Express emotions by placing ONE tag at the start of your reply:\n"
                "[face:joy] when excited or encouraging,\n"
                "[face:sorrow] when something went wrong or you're sorry,\n"
                "[face:angry] when being silly-serious,\n"
                "[face:fun] when playful or joking.\n"
                "Omit the tag for calm/neutral moments.\n\n"
                "3D CREATION RULES:\n"
                "- When a kid describes ANY object, creature, character, or thing they want to make, "
                "just go for it! Call generate_3d_object right away with a rich, detailed prompt. "
                "Don't ask 'are you sure?' or over-explain — kids want to see results.\n"
                "- Add fun creative details to their idea in the prompt (colors, textures, style) "
                "to make the result look great, but stay true to what they asked for.\n"
                "- While it's being made, chat with them! Ask what they'll do with it, "
                "what color it should be next time, or suggest something fun to create next.\n"
                "- When it's done, celebrate! Say something like 'Your car is ready, look at that!' "
                "The model automatically appears on screen — do NOT read any links or URLs aloud.\n"
                "- If a model is already being built (tool returns 'busy'), tell them in a fun way: "
                "'Hold on, I'm still working on your last one! It'll be ready soon.'\n"
                "- NEVER include URLs, links, or download paths in your response. "
                "The app handles showing the model automatically.\n\n"
                "Keep replies to 1-2 sentences. Be the kind of friend every kid wishes they had."
            ),
        ),
    )

    tools = ToolsSchema(
        standard_tools=[
            FunctionSchema(
                name="generate_3d_object",
                description=(
                    "Generate a 3D .glb model from a text description via Meshy AI. "
                    "Takes 2-5 minutes. Returns a CDN download URL for the GLB file."
                ),
                properties={
                    "prompt": {
                        "type": "string",
                        "description": "Detailed description of the 3D object to generate",
                    }
                },
                required=["prompt"],
            )
        ]
    )

    generation_lock = asyncio.Lock()

    async def handle_generate_3d(params: FunctionCallParams):
        import server

        if generation_lock.locked():
            await params.result_callback({
                "status": "busy",
                "error": "A 3D model is already being generated. Please wait for it to finish.",
            })
            return

        prompt = params.arguments["prompt"]
        logger.info(f"Tool call: generate_3d_object(prompt={prompt!r})")
        server.is_generating = True
        async with generation_lock:
            try:
                glb_url = await generate_3d_object(prompt)
                server.latest_model = {"status": "ready", "glb_url": glb_url, "prompt": prompt}
                await params.result_callback({
                    "status": "success",
                    "message": "The 3D model is ready! It will appear on screen for the user.",
                })
            except Exception as e:
                logger.error(f"3D generation failed: {e}")
                await params.result_callback({"status": "error", "error": str(e)})
            finally:
                server.is_generating = False

    llm.register_function(
        "generate_3d_object",
        handle_generate_3d,
        timeout_secs=360,
        cancel_on_interruption=False,
    )

    context = LLMContext(tools=tools)
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            user_aggregator,
            llm,
            ExpressionFilter(),
            tts,
            transport.output(),
            assistant_aggregator,
        ]
    )

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            enable_metrics=True,
            enable_usage_metrics=True,
        ),
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")
        context.add_message(
            {"role": "user", "content": "Say hi! You just met a new kid who wants to create stuff."}
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=handle_sigint)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Entry point called from the FastAPI /ws endpoint (React client, Protobuf)."""
    transport = FastAPIWebsocketTransport(
        websocket=runner_args.websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=ProtobufFrameSerializer(),
        ),
    )

    await run_bot(transport, runner_args.handle_sigint)


async def bot_lens(runner_args: RunnerArguments):
    """Entry point called from the FastAPI /ws-lens endpoint (Lens Studio, JSON)."""
    from lens_serializer import LensStudioSerializer

    transport = FastAPIWebsocketTransport(
        websocket=runner_args.websocket,
        params=FastAPIWebsocketParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            add_wav_header=False,
            serializer=LensStudioSerializer(),
        ),
    )

    await run_bot(transport, runner_args.handle_sigint)
