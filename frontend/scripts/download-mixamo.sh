#!/bin/bash
# Download Mixamo FBX animations for VRM avatar
#
# Mixamo animations require a free Adobe account.
# This script automates downloading once you provide your auth token.
#
# HOW TO GET YOUR AUTH TOKEN:
#   1. Go to https://www.mixamo.com and sign in (free Adobe account)
#   2. Open browser DevTools (F12) → Network tab
#   3. Click any animation in the Mixamo UI
#   4. Find a request to "api.mixamo.com" in the Network tab
#   5. Copy the value of the "Authorization" header (starts with "Bearer ...")
#   6. Paste it below or pass as first argument

set -e

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo ""
  echo "Usage: ./download-mixamo.sh 'Bearer YOUR_TOKEN_HERE'"
  echo ""
  echo "To get your token:"
  echo "  1. Go to https://www.mixamo.com and sign in"
  echo "  2. Open DevTools (F12) → Network tab"
  echo "  3. Click any animation"
  echo "  4. Find a request to api.mixamo.com"
  echo "  5. Copy the 'Authorization' header value"
  echo ""
  echo "OR download manually from mixamo.com:"
  echo "  Search for each animation, click Download with:"
  echo "    Format: FBX Binary (.fbx)"
  echo "    Skin: Without Skin"
  echo ""
  echo "  Required animations:"
  echo "    idle.fbx         → Search: 'Idle' (standing idle, breathing)"
  echo "    idle-1.fbx       → Search: 'Happy Idle' or 'Breathing Idle'"
  echo "    idle-2.fbx       → Search: 'Idle' (pick a different idle variant)"
  echo "    idle-3.fbx       → Search: 'Weight Shift' or 'Look Around'"
  echo "    talking-neutral-1.fbx → Search: 'Talking'"
  echo "    talking-happy.fbx     → Search: 'Happy' or 'Excited'"
  echo "    talking-angry.fbx     → Search: 'Angry' or 'Annoyed'"
  echo "    talking-arguing.fbx   → Search: 'Arguing'"
  echo "    talking-funny.fbx     → Search: 'Laughing' or 'Silly'"
  echo ""
  echo "  Place all files in: public/animations/"
  echo ""
  exit 1
fi

OUT_DIR="$(dirname "$0")/../public/animations"
mkdir -p "$OUT_DIR"

# Character ID for the default Y-Bot (used for "Without Skin" downloads)
CHAR_ID="c209fce0-8a0e-11e6-8a52-0a6aacdf9a04"
BASE="https://www.mixamo.com/api/v1"

download_anim() {
  local name="$1"
  local anim_id="$2"
  local out_file="$OUT_DIR/$name"

  if [ -f "$out_file" ]; then
    echo "✓ $name already exists, skipping"
    return
  fi

  echo "→ Requesting export for $name (anim: $anim_id)..."

  # Request export
  local export_resp
  export_resp=$(curl -s "$BASE/animations/export" \
    -H "Authorization: $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"character_id\": \"$CHAR_ID\",
      \"product_name\": \"$anim_id\",
      \"type\": \"Character\",
      \"preferences\": {
        \"format\": \"fbx7\",
        \"skin\": \"false\",
        \"fps\": \"30\",
        \"reducekf\": \"0\"
      }
    }")

  local job_id
  job_id=$(echo "$export_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('uuid',''))" 2>/dev/null)

  if [ -z "$job_id" ]; then
    echo "  ✗ Failed to start export for $name"
    echo "  Response: $export_resp"
    return
  fi

  # Poll for completion
  echo "  Waiting for export (job: $job_id)..."
  local status=""
  local download_url=""
  for i in $(seq 1 30); do
    sleep 2
    local check
    check=$(curl -s "$BASE/characters/$CHAR_ID/monitor" \
      -H "Authorization: $TOKEN")

    status=$(echo "$check" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)

    if [ "$status" = "completed" ]; then
      download_url=$(echo "$check" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_result',''))" 2>/dev/null)
      break
    fi
    echo "  ... status: $status ($i/30)"
  done

  if [ -z "$download_url" ]; then
    echo "  ✗ Export timed out for $name"
    return
  fi

  echo "  Downloading $name..."
  curl -sL "$download_url" -o "$out_file"
  echo "  ✓ Saved $out_file"
}

echo "Downloading Mixamo animations..."
echo "Output directory: $OUT_DIR"
echo ""

# These are common Mixamo animation product names
# You may need to adjust IDs based on your Mixamo library
download_anim "idle.fbx" "Idle"
download_anim "idle-1.fbx" "Happy Idle"
download_anim "idle-2.fbx" "Breathing Idle"
download_anim "idle-3.fbx" "Weight Shift"
download_anim "talking-neutral-1.fbx" "Talking"
download_anim "talking-happy.fbx" "Excited"
download_anim "talking-angry.fbx" "Angry"
download_anim "talking-arguing.fbx" "Arguing"
download_anim "talking-funny.fbx" "Laughing"

echo ""
echo "Done! Check $OUT_DIR for your animation files."
