#
# Copyright (c) 2024-2026, Daily
#
# SPDX-License-Identifier: BSD 2-Clause License
#

"""Pipecat Voice AI Bot with WebSocket transport.

Runs a FastAPI server with a /ws WebSocket endpoint that clients
connect to for real-time voice conversations.

Required AI services:
- Deepgram (Speech-to-Text)
- Grok (LLM)
- Cartesia (Text-to-Speech)

Run the bot using::

    uvicorn server:app --host 0.0.0.0 --port 8765
"""

import os
import re

from dotenv import load_dotenv
from loguru import logger

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
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.grok import GrokLLMService
from pipecat.transports.base_transport import BaseTransport
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)

load_dotenv(override=True)

_TAG_RE = re.compile(r"\[(?:face|animation):\w+\]")


class ExpressionFilter(FrameProcessor):
    """Strips [face:name] and [animation:name] tags from TextFrames.

    Tags are left in the conversation context (so the LLM sees them) but
    removed before TTS so they aren't spoken aloud.  Handles tags split
    across chunked frames by buffering partial matches.
    """

    def __init__(self):
        super().__init__()
        self._buf = ""

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TextFrame):
            self._buf += frame.text
            # Flush only when no partial tag is open at the end
            if "[" in self._buf and "]" not in self._buf.split("[")[-1]:
                return  # wait for the rest of the tag
            cleaned = _TAG_RE.sub("", self._buf)
            self._buf = ""
            if cleaned:
                await self.push_frame(TextFrame(text=cleaned))
        else:
            # Flush anything buffered before passing non-text frames
            if self._buf:
                cleaned = _TAG_RE.sub("", self._buf)
                self._buf = ""
                if cleaned:
                    await self.push_frame(TextFrame(text=cleaned))
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

    llm = GrokLLMService(
        api_key=os.getenv("XAI_API_KEY"),
        settings=GrokLLMService.Settings(
            model="grok-4-1-fast-non-reasoning",
            temperature=0.7,
            top_p=0.9,
            max_completion_tokens=1024,
            system_instruction=(
                "You are a friendly AI assistant avatar. "
                "Respond naturally and conversationally in 1-3 sentences. "
                "Express emotions by placing ONE tag at the start of your reply: "
                "[face:joy] when happy or encouraging, "
                "[face:sorrow] when sympathetic or sad, "
                "[face:angry] when expressing concern, "
                "[face:fun] when playful or joking. "
                "Omit the tag for neutral responses. "
                "Example: '[face:joy] That's wonderful progress!'"
            ),
        ),
    )

    # ExpressionFilter is defined above but not used in the pipeline
    # because stripping [face:name] tags from TextFrames also removes
    # them from the conversation text the client needs for expressions.
    # Instead, tags are parsed client-side and stripped from subtitles only.

    context = LLMContext()
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
            {"role": "user", "content": "Say hello and briefly introduce yourself."}
        )
        await task.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await task.cancel()

    runner = PipelineRunner(handle_sigint=handle_sigint)
    await runner.run(task)


async def bot(runner_args: RunnerArguments):
    """Entry point called from the FastAPI /ws endpoint."""
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
