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


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8765"))
    uvicorn.run(app, host="0.0.0.0", port=port)
