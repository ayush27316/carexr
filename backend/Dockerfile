FROM dailyco/pipecat-base:latest

# Enable bytecode compilation
ENV UV_COMPILE_BYTECODE=1

# Install the project's dependencies using the lockfile and settings
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-install-project --no-dev

# Copy the application code
COPY ./bot.py bot.py

EXPOSE 7860

CMD ["uv", "run", "bot.py"]
