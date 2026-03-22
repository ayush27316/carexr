"""JSON frame serializer for Lens Studio WebSocket clients.

Speaks a simple JSON protocol that Lens Studio's InternetModule.createWebSocket()
can parse.  Audio is base64-encoded PCM16; text and expressions are plain JSON.

Wire format (all messages are JSON text over WebSocket):

  Client → Server:
    {"type": "audio", "data": "<base64 PCM16>", "sampleRate": 16000}

  Server → Client:
    {"type": "audio", "data": "<base64 PCM16>"}
    {"type": "text", "text": "Hello!"}
    {"type": "transcription", "text": "User said...", "userId": "..."}
    {"type": "expression", "name": "joy"}
    {"type": "message", "data": { ... }}
"""

import base64
import json
from dataclasses import dataclass
from typing import Optional

from loguru import logger

from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    InputTransportMessageFrame,
    OutputAudioRawFrame,
    OutputTransportMessageFrame,
    OutputTransportMessageUrgentFrame,
    TextFrame,
    TranscriptionFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer


@dataclass
class ExpressionFrame(Frame):
    """Synthetic frame carrying an expression name extracted from LLM output."""

    expression_name: str = ""


class LensStudioSerializer(FrameSerializer):
    """Serializes Pipecat frames as JSON text for Lens Studio clients."""

    def __init__(
        self,
        audio_sample_rate: int = 24000,
        params: Optional[FrameSerializer.InputParams] = None,
    ):
        super().__init__(params)
        self._audio_sample_rate = audio_sample_rate

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, (OutputTransportMessageFrame, OutputTransportMessageUrgentFrame)):
            if self.should_ignore_frame(frame):
                return None
            return json.dumps({"type": "message", "data": frame.message})

        if isinstance(frame, ExpressionFrame):
            return json.dumps({"type": "expression", "name": frame.expression_name})

        if isinstance(frame, OutputAudioRawFrame):
            return json.dumps({
                "type": "audio",
                "data": base64.b64encode(frame.audio).decode("ascii"),
            })

        if isinstance(frame, TranscriptionFrame):
            return json.dumps({
                "type": "transcription",
                "text": frame.text,
                "userId": frame.user_id,
            })

        if isinstance(frame, TextFrame):
            return json.dumps({"type": "text", "text": frame.text})

        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        try:
            if isinstance(data, bytes):
                data = data.decode("utf-8")
            msg = json.loads(data)
        except (json.JSONDecodeError, UnicodeDecodeError):
            logger.warning("LensStudioSerializer: failed to parse incoming message")
            return None

        msg_type = msg.get("type")

        if msg_type == "audio":
            audio_bytes = base64.b64decode(msg["data"])
            sample_rate = msg.get("sampleRate", self._audio_sample_rate)
            return InputAudioRawFrame(
                audio=audio_bytes,
                sample_rate=sample_rate,
                num_channels=1,
            )

        if msg_type == "message":
            return InputTransportMessageFrame(message=msg.get("data", {}))

        logger.debug(f"LensStudioSerializer: ignoring message type '{msg_type}'")
        return None
