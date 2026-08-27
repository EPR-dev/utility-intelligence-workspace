#!/bin/sh
set -e
cd /app
python3 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 &
cd /app/frontend
exec npx next start -H 0.0.0.0 -p "${PORT:-8080}"
