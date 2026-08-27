"""
Utility Intelligence Workspace
==============================

Problem
-------
Electricity distributors are dealing with rooftop solar, batteries, electrification and
new connections faster than public maps and account teams can keep up. The interesting
question is rarely “run a power flow”. It is: where should we look, what should we ask,
and what data would we need before anyone models anything.

Purpose
-------
This project is an internal commercial + technical intelligence workstation. It uses
public spatial and energy data to support account research, opportunity discovery,
data-readiness assessment and customer conversations for an electricity-network
technology company.

It is **not** GridSight, not a clone of GridSight, and not affiliated with GridSight
or Endeavour Energy.

What it does
------------
- Maps Endeavour Energy’s public territory, zone/transmission substations and
  distribution-substation remaining **load** capacity.
- Joins Clean Energy Regulator postcode statistics for rooftop solar, batteries
  (from July 2025) and heat pumps.
- Scores postcodes with a transparent, relative framework (Flexible Export,
  Network Visibility, Connection Assessment, DER Orchestration).
- Produces opportunity cards, account briefs, discovery questions and a
  meeting-prep pack.
- Inspects uploaded GIS/CSV extracts for implementation readiness.
- Runs lightweight **strategic scenario indicators** (not power flow).
- Answers questions in Grid Analyst with a hard split: observed evidence vs hypothesis.

What it does not do
-------------------
- Power-flow analysis
- Operational network modelling
- Utility-grade engineering conclusions
- Substitute for proprietary topology, AMI, DER registers or hosting-capacity models
- Claim that a high score means a constraint exists

Technical architecture
----------------------
- `config/networks/*.json` — add another DNSP by configuration, not a rewrite
- `pipelines/build_network_bundle.py` — fetch, join, score, write `data/processed`
- `scoring/engine.py` — percentile ranks + explicit weights
- `backend/` — FastAPI (layers, analyst, brief, readiness, scenario, compare)
- `frontend/` — Next.js + MapLibre, map-dominant three-pane workstation

Data sources
------------
See `docs/DATA_SOURCES.md`. Raw downloads stay in `data/raw/` and are never modified.
Processed outputs live in `data/processed/`. Demo uploads in `data/demo/` are
**synthetic demonstration data**.

Run locally
-----------
Python 3.12+ and Node 20+ assumed.

    python -m pip install -r backend/requirements.txt
    python pipelines/build_network_bundle.py

    uvicorn backend.app.main:app --port 8000 --reload

    cd frontend
    npm install
    npm run dev

Open http://localhost:3000 (or 3001 if 3000 is already taken).

Share / hosted demo
-------------------
The live app is a Next.js project (`frontend/`). Map layers and the intelligence
API run in that app, so it deploys to Vercel like any other Next site.

Public source: https://github.com/EPR-dev/utility-intelligence-workspace

Deploy: https://vercel.com/new/clone?repository-url=https://github.com/EPR-dev/utility-intelligence-workspace&project-name=utility-intelligence-workspace&root-directory=frontend

Set Root Directory to `frontend`. Optional env var `NEXT_PUBLIC_CARTO_API_KEY`
(same value as `frontend/.env.local`) avoids a CARTO watermark on raster tiles.
Add it in Vercel **before** the first production build.

Use Chrome or Edge. MapLibre 6 needs WebGL2; the intelligence panels still work without it.
The street basemap is CARTO Dark Matter (vector). Raster CARTO tiles watermark without a key —
vector currently does not. Optional: request a free key at https://carto.com/basemaps/apikey
and set `NEXT_PUBLIC_CARTO_API_KEY` in `frontend/.env.local`.

Local UI: `cd frontend && npm run dev`. FastAPI on port 8000 is optional
(`NEXT_PUBLIC_API_URL` if you still want it). Rebuild processed layers with
`python pipelines/build_network_bundle.py`.

On Windows you can also run `scripts/dev.ps1`.

Tests
-----
    python -m pytest tests -q

Future development
------------------
- Private utility data under NDA (feeders, LV connectivity, AMI, DER register)
- Additional DNSPs via extra files in `config/networks/`
- CRM integration for account briefs
- Automatic scheduled CER/Endeavour refreshes
- Better demographic growth (ABS Census — connector exists, data not yet connected)
- Implementation workflows beyond the readiness checklist

Licence / attribution
---------------------
Endeavour Energy open assets: ODbL for most published layers.
ABS postal areas: CC BY 4.0.
CER: attribute the Clean Energy Regulator; check current reuse terms.
OpenStreetMap: ODbL, © OpenStreetMap contributors.
CARTO/OSM basemap: follow their attribution requirements.
