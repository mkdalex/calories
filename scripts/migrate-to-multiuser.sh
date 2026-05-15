#!/bin/bash
# One-time migration: move existing single-user data files into per-user folders.
# Run this ONCE after deploying the multi-user version, on the droplet, while the
# server is stopped. Pass your Discord user ID as the first argument:
#
#   pm2 stop calories
#   bash scripts/migrate-to-multiuser.sh 269025426062573568
#   pm2 start calories

set -e

USER_ID="$1"
if [ -z "$USER_ID" ]; then
  echo "Usage: $0 <discord-user-id>"
  echo "  e.g. $0 269025426062573568"
  exit 1
fi

DATA_DIR="${CALORIES_DATA_DIR:-./data}"
TARGET="$DATA_DIR/users/$USER_ID"

if [ ! -d "$DATA_DIR" ]; then
  echo "Data dir $DATA_DIR not found. Run from the calories project root."
  exit 1
fi

mkdir -p "$TARGET"
echo "Migrating data into $TARGET ..."

for f in profile.json log.json weight.json templates.json custom_foods.json water.json favorites_meta.json; do
  if [ -f "$DATA_DIR/$f" ]; then
    mv "$DATA_DIR/$f" "$TARGET/$f"
    echo "  moved $f"
  fi
done

echo "Done. Shared files (usage.json, ai_calls.log, sessions.json) stay in $DATA_DIR."
