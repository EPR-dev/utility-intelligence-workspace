type Issue = { severity: string; title: string; detail: string };
type Schema = { required?: string[]; properties?: Record<string, unknown> };

const USE_CASES: Record<string, { label: string; needed: string[] }> = {
  flexible_exports: {
    label: "Flexible Exports",
    needed: ["feeder topology", "substation assets", "DER register", "interval smart meter data", "voltage observations", "inverter export limits"],
  },
  network_visibility: {
    label: "Network Visibility",
    needed: ["GIS asset files", "feeder topology", "substation assets", "customer-to-network location", "topology update metadata"],
  },
  connections: {
    label: "Connection Assessment",
    needed: ["substation assets", "feeder topology", "remaining capacity", "connection queue", "large-load enquiries"],
  },
  orchestration: {
    label: "DER Orchestration",
    needed: ["DER register", "interval smart meter data", "inverter export limits", "battery / EV identifiers", "constraint signals"],
  },
};

const SCHEMAS: Record<string, Schema> = {
  feeder: { required: ["feeder_id", "zone_substation_id"], properties: { feeder_id: {}, feeder_name: {}, zone_substation_id: {}, voltage_kv: {}, customers: {}, length_km: {} } },
  substation: { required: ["substation_id"], properties: { substation_id: {}, name: {}, type: {}, voltage_kv: {}, latitude: {}, longitude: {}, parent_id: {} } },
  der: { required: ["der_id"], properties: { der_id: {}, nmi: {}, technology: {}, capacity_kw: {}, export_limit_kw: {}, install_date: {}, latitude: {}, longitude: {}, feeder_id: {} } },
  ami: { required: ["nmi", "interval_end", "kwh"], properties: { nmi: {}, interval_end: {}, kwh: {}, kvarh: {}, quality_flag: {} } },
};

const BBOX: [number, number, number, number] = [149.6, -35.7, 151.2, -32.3];

export async function inspectUpload(filename: string, content: ArrayBuffer, datasetKind: string, useCase: string) {
  const lower = filename.toLowerCase();
  let table: { columns: string[]; rows: Record<string, string>[] };
  let geometryRows: { ok: boolean; coords: [number, number][] }[] = [];

  if (lower.endsWith(".csv")) {
    table = readCsv(new TextDecoder("utf-8").decode(content));
  } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    const parsed = readGeojson(new TextDecoder("utf-8").decode(content));
    table = parsed.table;
    geometryRows = parsed.geoms;
  } else if (lower.endsWith(".gpkg")) {
    return {
      filename,
      datasetKind,
      issues: [
        {
          severity: "medium",
          title: "GeoPackage parser is a stub in V1",
          detail: "Upload accepted. Full GeoPackage inspection is not yet connected. Convert to GeoJSON or CSV for a complete score.",
        },
      ],
      status: "not_fully_connected",
      readiness: { overall: 40, completeness: 40, schema: 40, spatial: 40, relationships: 40, consistency: 40 },
      checklist: checklist(datasetKind, useCase),
    };
  } else {
    throw new Error("Supported uploads: CSV, GeoJSON, GeoPackage.");
  }

  const schema = SCHEMAS[datasetKind] || { required: [], properties: {} };
  const issues: Issue[] = [];
  const columns = table.columns;
  const rows = table.rows;
  const n = rows.length;
  const expected = Object.keys(schema.properties || {});
  const required = schema.required || [];
  const unexpected = expected.length ? columns.filter((c) => !expected.includes(c)) : [];
  const missing = expected.filter((c) => !columns.includes(c));

  if (missing.length) {
    issues.push({
      severity: missing.some((c) => required.includes(c)) ? "high" : "medium",
      title: "Schema gaps",
      detail: `Expected columns not found: ${missing.join(", ") || "—"}.`,
    });
  }
  if (unexpected.length) {
    issues.push({
      severity: "info",
      title: "Unexpected columns",
      detail: `${unexpected.slice(0, 12).join(", ")}${unexpected.length > 12 ? "…" : ""}`,
    });
  }

  const nullCounts: Record<string, number> = {};
  for (const c of columns) {
    nullCounts[c] = rows.filter((r) => ["", "null", "NA"].includes(String(r[c] ?? "").trim()) || r[c] == null).length;
  }
  const completenessVals = n && columns.length ? columns.map((c) => (n - nullCounts[c]) / n) : [0];
  const completeness = 100 * (completenessVals.reduce((a, b) => a + b, 0) / completenessVals.length);

  const idCols = columns.filter((c) => c.endsWith("_id") || ["nmi", "id", "asset_id"].includes(c));
  const missingIds = idCols.reduce((sum, c) => sum + (nullCounts[c] || 0), 0);
  if (missingIds) issues.push({ severity: "high", title: "Missing identifiers", detail: `${missingIds} identifier cells are empty.` });

  let dup = 0;
  if (idCols.length) {
    const seen: Record<string, number> = {};
    for (const r of rows) {
      const key = idCols.map((c) => String(r[c] || "")).join("|");
      if (!key.replaceAll("|", "").trim()) continue;
      seen[key] = (seen[key] || 0) + 1;
    }
    dup = Object.values(seen).reduce((s, v) => s + (v > 1 ? v - 1 : 0), 0);
    if (dup) issues.push({ severity: "medium", title: "Duplicate records", detail: `${dup} extra rows share an identifier.` });
  }

  let spatialScore = 80;
  if (geometryRows.length) {
    let invalid = 0;
    let outside = 0;
    for (const g of geometryRows) {
      if (!g.ok) invalid += 1;
      for (const [lon, lat] of g.coords.slice(0, 20)) {
        if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          invalid += 1;
          issues.push({ severity: "high", title: "Impossible coordinates", detail: `Coordinate (${lon}, ${lat}) is outside WGS84 bounds.` });
          break;
        }
        const [minx, miny, maxx, maxy] = BBOX;
        if (!(minx - 0.2 <= lon && lon <= maxx + 0.2 && miny - 0.2 <= lat && lat <= maxy + 0.2)) {
          outside += 1;
          break;
        }
      }
    }
    if (invalid) {
      issues.push({ severity: "high", title: "Invalid geometries", detail: `${invalid} features failed basic geometry checks.` });
      spatialScore -= Math.min(40, invalid);
    }
    if (outside) {
      issues.push({
        severity: "medium",
        title: "Assets outside indicative territory",
        detail: `${outside} features sit outside a padded Endeavour bounding box. Confirm CRS and network.`,
      });
      spatialScore -= Math.min(25, Math.floor(outside / 2));
    }
    issues.push({ severity: "info", title: "CRS assumption", detail: "GeoJSON is treated as EPSG:4326 (WGS84) for web visualisation." });
  } else if (["gis", "substation", "der"].includes(datasetKind)) {
    const lat = columns.find((c) => c.toLowerCase().includes("lat"));
    const lon = columns.find((c) => c.toLowerCase().includes("lon") || c.toLowerCase().includes("lng"));
    if (!lat || !lon) {
      issues.push({ severity: "medium", title: "No geometry", detail: "No latitude/longitude columns and no GeoJSON geometry." });
      spatialScore = 45;
    } else spatialScore = 75;
  }

  let relScore = 88;
  if (datasetKind === "feeder" && columns.includes("zone_substation_id")) {
    const missingParent = rows.filter((r) => !r.zone_substation_id).length;
    if (missingParent) {
      issues.push({
        severity: "high",
        title: "Broken feeder → substation relationship",
        detail: `${missingParent} feeder records do not reference a parent zone substation.`,
      });
      relScore = Math.max(20, 90 - missingParent);
    }
  }
  if (datasetKind === "der" && columns.includes("feeder_id")) {
    const missingFeeder = rows.filter((r) => !r.feeder_id).length;
    if (missingFeeder) {
      issues.push({
        severity: "medium",
        title: "DER not associated with a feeder",
        detail: `${missingFeeder} DER records have no feeder_id. Spatial association was not attempted on this file.`,
      });
      relScore = Math.max(30, 90 - Math.floor(missingFeeder / 2));
    }
  }

  let consistency = 90;
  for (const c of columns) {
    const cl = c.toLowerCase();
    if (["kw", "kva", "capacity", "length", "customer"].some((tok) => cl.includes(tok))) {
      const neg = rows.filter((r) => {
        const n = Number(r[c] || 0);
        return Number.isFinite(n) && n < 0;
      }).length;
      if (neg) {
        issues.push({ severity: "high", title: "Negative capacities", detail: `${neg} values in ${c} are negative.` });
        consistency -= Math.min(30, neg);
      }
    }
    if (cl.includes("date") || cl.endsWith("_end") || cl.includes("timestamp")) {
      const bad = rows.filter((r) => r[c] && !looksLikeDate(String(r[c]))).length;
      if (bad) {
        issues.push({ severity: "medium", title: "Invalid dates", detail: `${bad} values in ${c} are not ISO-like dates.` });
        consistency -= Math.min(20, Math.floor(bad / 3));
      }
    }
  }

  let schemaScore = 100;
  if (required.length) {
    const presentReq = required.filter((c) => columns.includes(c)).length;
    schemaScore = (100 * presentReq) / required.length - Math.min(15, unexpected.length);
    schemaScore = Math.max(0, schemaScore);
  }

  const overall = Math.round(0.25 * completeness + 0.2 * schemaScore + 0.2 * Math.max(0, spatialScore) + 0.2 * relScore + 0.15 * Math.max(0, consistency));
  issues.sort((a, b) => ({ high: 0, medium: 1, info: 2 }[a.severity] ?? 3) - ({ high: 0, medium: 1, info: 2 }[b.severity] ?? 3));

  return {
    filename,
    datasetKind,
    rowCount: n,
    columns,
    nullCounts,
    issues,
    readiness: {
      overall: Math.max(0, Math.min(100, overall)),
      completeness: Math.trunc(completeness),
      schema: Math.trunc(Math.max(0, schemaScore)),
      spatial: Math.trunc(Math.max(0, spatialScore)),
      relationships: Math.trunc(Math.max(0, relScore)),
      consistency: Math.trunc(Math.max(0, consistency)),
    },
    checklist: checklist(datasetKind, useCase),
    syntheticNotice: "If this file came from data/demo, it is synthetic demonstration data.",
  };
}

function checklist(datasetKind: string, useCase: string) {
  const spec = USE_CASES[useCase] || USE_CASES.flexible_exports;
  const kindMap: Record<string, string> = {
    feeder: "feeder topology",
    substation: "substation assets",
    der: "DER register",
    ami: "interval smart meter data",
    gis: "GIS asset files",
    scada: "voltage observations",
    connection: "connection queue",
  };
  const have = new Set([kindMap[datasetKind] || datasetKind]);
  const available: string[] = [];
  const missing: string[] = [];
  const clarify: string[] = [];
  for (const item of spec.needed) {
    if (have.has(item) || [...have].some((h) => item.startsWith(h))) available.push(item);
    else if (["topology update metadata", "inverter export limits", "constraint signals"].includes(item)) clarify.push(item);
    else missing.push(item);
  }
  let nextStep = "Upload a feeder extract and a DER register for the same depot so relationships can be tested.";
  if (datasetKind === "feeder") nextStep = "Add the parent zone-substation table and a DER register joined on feeder_id.";
  if (datasetKind === "ami") nextStep = "Confirm interval length, quality flags and whether reverse flow is signed.";
  return { useCase: spec.label, available, missing, requiresClarification: clarify, recommendedNextStep: nextStep };
}

function readCsv(text: string) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.length);
  if (!lines.length) return { columns: [] as string[], rows: [] as Record<string, string>[] };
  const columns = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row: Record<string, string> = {};
    columns.forEach((c, i) => {
      row[c] = (vals[i] ?? "").trim();
    });
    return row;
  });
  return { columns, rows };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function readGeojson(text: string) {
  const data = JSON.parse(text);
  const features = Array.isArray(data.features) ? data.features : Array.isArray(data) ? data : [data];
  const rows: Record<string, string>[] = [];
  const geoms: { ok: boolean; coords: [number, number][] }[] = [];
  const columns: string[] = [];
  for (const f of features) {
    const props = { ...(f.properties || {}) } as Record<string, unknown>;
    const geom = f.geometry || {};
    const ok = ["Point", "LineString", "Polygon", "MultiPoint", "MultiLineString", "MultiPolygon"].includes(geom.type);
    const coords = flattenCoords(geom.coordinates);
    geoms.push({ ok: ok && coords.length > 0, coords });
    for (const k of Object.keys(props)) if (!columns.includes(k)) columns.push(k);
    rows.push(Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v == null ? "" : String(v)])));
  }
  return { table: { columns, rows }, geoms };
}

function flattenCoords(c: unknown): [number, number][] {
  if (c == null) return [];
  if (Array.isArray(c) && c.length && typeof c[0] === "number") {
    return c.length >= 2 ? [[Number(c[0]), Number(c[1])]] : [];
  }
  if (Array.isArray(c)) return c.flatMap(flattenCoords);
  return [];
}

function looksLikeDate(v: string): boolean {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return true;
  return !Number.isNaN(Date.parse(s));
}
