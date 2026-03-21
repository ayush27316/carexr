FROM python:3.11-slim

# Install system dependencies needed by pipecat (audio, VAD, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsndfile1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1

WORKDIR /app

# Install dependencies
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-install-project --no-dev

# Copy the application code
COPY ./bot.py bot.py
COPY ./server.py server.py

CMD ["sh", "-c", "uv run uvicorn server:app --host 0.0.0.0 --port ${PORT:-8765}"]
