#!/usr/bin/env bash
set -e

# Local development script - starts both backend and frontend

BACKEND_PORT="${BACKEND_PORT:-8765}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Done."
}
trap cleanup EXIT INT TERM

# Start backend
echo "Starting backend on port $BACKEND_PORT..."
cd backend
uv sync --quiet
uv run uvicorn server:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!
cd ..

# Wait for backend to be ready
echo "Waiting for backend..."
for i in $(seq 1 30); do
    if curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
        echo "Backend ready!"
        break
    fi
    sleep 1
done

# Start frontend
echo "Starting frontend on port $FRONTEND_PORT..."
cd frontend
npm install --silent
VITE_PIPECAT_API_URL="http://localhost:$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!
cd ..

echo ""
echo "========================================="
echo "  Backend:  http://localhost:$BACKEND_PORT"
echo "  Frontend: http://localhost:$FRONTEND_PORT"
echo "  WebSocket: ws://localhost:$BACKEND_PORT/ws"
echo "========================================="
echo ""

wait
