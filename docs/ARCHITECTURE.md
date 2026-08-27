# Architecture

```
config/networks/<dnsp>.json
        │
        ▼
pipelines/build_network_bundle.py  ──► data/processed/<dnsp>/
        │                              bundle.json + GeoJSON layers
        ▼
scoring/engine.py                  percentile ranks + declared weights
        │
        ▼
backend/app/main.py (FastAPI)     layers, analyst, brief, readiness, scenario
        │
        ▼
frontend (Next.js + MapLibre)      seven workspaces, one map
```

Adding a network later should mean a new config file, a pipeline variant or parameter,
and a processed folder — not a new application.

Product rule: if a feature does not help someone understand a utility customer, spot an
interesting public-data pattern, prepare a conversation, or start implementation, it
does not belong here.
