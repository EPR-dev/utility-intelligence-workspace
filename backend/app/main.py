from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from backend.app.analyst import analyse
from backend.app.brief import compare, meeting_pack, render_markdown, scenario_shift, reweight
from backend.app.readiness import inspect_upload
from backend.app.store import layer_path, list_networks, load_bundle, load_network_config

app = FastAPI(
    title="Utility Intelligence Workspace",
    version="0.1.0",
    description="Strategic indicators and hypotheses from public spatial and energy data. Not power-flow software.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"https://.*\.(onrender\.com|fly\.dev|railway\.app|vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalystBody(BaseModel):
    question: str
    postcode: str | None = None
    networkId: str = "endeavour-energy"


class WeightsBody(BaseModel):
    networkId: str = "endeavour-energy"
    weights: dict[str, dict[str, float]]


class ScenarioBody(BaseModel):
    networkId: str = "endeavour-energy"
    postcode: str
    homes: float = 0
    solarMw: float = 0
    batteryMwh: float = 0
    evChargers: float = 0
    commercialMw: float = 0


class CompareBody(BaseModel):
    networkId: str = "endeavour-energy"
    a: str
    b: str


class MeetingBody(BaseModel):
    networkId: str = "endeavour-energy"
    topic: str = "general discovery"
    postcode: str | None = None


class BriefBody(BaseModel):
    networkId: str = "endeavour-energy"
    format: str = Field(default="markdown", pattern="^(markdown|html)$")
    topic: str | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "product": "Utility Intelligence Workspace"}


@app.get("/api/networks")
def networks():
    return {"networks": list_networks()}


@app.get("/api/networks/{network_id}/config")
def network_config(network_id: str):
    try:
        return load_network_config(network_id)
    except FileNotFoundError:
        raise HTTPException(404, "Unknown network")


@app.get("/api/networks/{network_id}/bundle")
def bundle(network_id: str):
    try:
        return load_bundle(network_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


@app.get("/api/networks/{network_id}/layers/{name}")
def layer(network_id: str, name: str):
    try:
        path = layer_path(network_id, name)
    except KeyError:
        raise HTTPException(400, "Unknown layer")
    except FileNotFoundError:
        raise HTTPException(404, "Layer not built")
    return Response(path.read_bytes(), media_type="application/geo+json")


@app.post("/api/analyst")
def analyst(body: AnalystBody):
    b = _bundle(body.networkId)
    return analyse(body.question, b, body.postcode)


@app.post("/api/score/reweight")
def score_reweight(body: WeightsBody):
    return reweight(_bundle(body.networkId), body.weights)


@app.post("/api/scenario")
def scenario(body: ScenarioBody):
    try:
        return scenario_shift(
            _bundle(body.networkId),
            body.postcode,
            {
                "homes": body.homes,
                "solarMw": body.solarMw,
                "batteryMwh": body.batteryMwh,
                "evChargers": body.evChargers,
                "commercialMw": body.commercialMw,
            },
        )
    except KeyError:
        raise HTTPException(404, "Unknown postcode")


@app.post("/api/compare")
def compare_areas(body: CompareBody):
    try:
        return compare(_bundle(body.networkId), body.a, body.b)
    except StopIteration:
        raise HTTPException(404, "Unknown postcode")


@app.post("/api/meeting")
def meeting(body: MeetingBody):
    return meeting_pack(_bundle(body.networkId), body.topic, body.postcode)


@app.post("/api/brief")
def brief(body: BriefBody):
    md = render_markdown(_bundle(body.networkId), body.topic)
    if body.format == "html":
        html = _print_html(md)
        return Response(html, media_type="text/html")
    return PlainTextResponse(md)


@app.post("/api/readiness/upload")
async def readiness_upload(
    file: UploadFile = File(...),
    datasetKind: str = Form("feeder"),
    useCase: str = Form("flexible_exports"),
    networkId: str = Form("endeavour-energy"),
):
    content = await file.read()
    if len(content) > 15_000_000:
        raise HTTPException(400, "File too large for this demo (15 MB).")
    bbox = (149.6, -35.7, 151.2, -32.3)
    try:
        return inspect_upload(file.filename or "upload.csv", content, datasetKind, useCase, bbox)
    except ValueError as e:
        raise HTTPException(400, str(e))


def _bundle(network_id: str):
    try:
        return load_bundle(network_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))


def _print_html(md: str) -> str:
    escaped = (
        md.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    body = []
    for line in escaped.splitlines():
        if line.startswith("# "):
            body.append(f"<h1>{line[2:]}</h1>")
        elif line.startswith("## "):
            body.append(f"<h2>{line[3:]}</h2>")
        elif line.startswith("### "):
            body.append(f"<h3>{line[4:]}</h3>")
        elif line.startswith("> "):
            body.append(f"<blockquote>{line[2:]}</blockquote>")
        elif line.startswith("- "):
            body.append(f"<li>{line[2:]}</li>")
        elif line.startswith("|"):
            body.append(f"<pre>{line}</pre>")
        elif line.strip() == "":
            body.append("<br/>")
        else:
            body.append(f"<p>{line}</p>")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Account brief</title>
<style>
  body {{ font-family: Georgia, serif; max-width: 820px; margin: 40px auto; color: #111; }}
  h1,h2,h3 {{ font-family: 'Segoe UI', sans-serif; }}
  blockquote {{ background: #f4f1ea; padding: 12px 16px; border-left: 4px solid #444; }}
  li {{ margin-left: 1.2em; }}
  @media print {{ body {{ margin: 16px; }} }}
</style></head><body>{''.join(body)}</body></html>"""
