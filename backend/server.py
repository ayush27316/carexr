"""FastAPI server with WebSocket endpoint for the Pipecat voice bot.

Run:
    uvicorn server:app --host 0.0.0.0 --port 8765
"""

import os
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

load_dotenv(override=True)

latest_model: dict | None = None
is_generating: bool = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Pipecat WebSocket server starting")
    yield
    logger.info("Pipecat WebSocket server shutting down")


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/latest-model")
async def get_latest_model():
    return {
        "generating": is_generating,
        **(latest_model or {"status": "none"}),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket client connected to /ws")

    try:
        from bot import bot
        from pipecat.runner.types import WebSocketRunnerArguments

        runner_args = WebSocketRunnerArguments(websocket=websocket, body={})
        await bot(runner_args)
    except Exception as e:
        logger.exception(f"Error running bot: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


@app.websocket("/ws-lens")
async def websocket_lens_endpoint(websocket: WebSocket):
    """WebSocket endpoint for Lens Studio clients using JSON serialization."""
    await websocket.accept()
    logger.info("Lens Studio client connected to /ws-lens")

    try:
        from bot import bot_lens
        from pipecat.runner.types import WebSocketRunnerArguments

        runner_args = WebSocketRunnerArguments(websocket=websocket, body={})
        await bot_lens(runner_args)
    except Exception as e:
        logger.exception(f"Error running Lens Studio bot: {e}")
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port)
