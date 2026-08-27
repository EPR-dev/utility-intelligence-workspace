export type WorkspaceId =
  | "overview"
  | "opportunity"
  | "account"
  | "readiness"
  | "scenario"
  | "analyst"
  | "sources";

export type ScoreKind =
  | "flexibleExport"
  | "networkVisibility"
  | "connectionAssessment"
  | "derOrchestration"
  | "composite";

export type SourceStatus = "connected" | "not_connected";

export interface Metrics {
  solarInstallsTotal: number;
  solarKwTotal: number;
  solarInstallsRecent: number;
  solarGrowthPct: number;
  recentSolarInstallShare: number;
  batteryInstalls: number;
  batteryKwh: number;
  heatPumpInstalls: number;
  distSubstationCount: number;
  zoneSubstationCount: number;
  meanAvailableKva: number | null;
  minAvailableKva: number | null;
  availableKvaCv: number | null;
  capacitySampleCount: number;
  areaSqKm: number;
  solarKwPerKm2: number;
  batteryInstallsPerKm2: number;
  distSubstationsPerKm2: number;
  heatPumpInstallsPerKm2: number;
  industrialCount: number;
  commercialCount: number;
  evChargerCount: number;
  focusWeight: number;
  centroid: [number, number];
  solarTimeline: Record<string, number>;
  batteryTimeline: Record<string, number>;
}

export interface PostcodeRecord {
  id: string;
  postcode: string;
  name: string;
  localities: string[];
  region: string;
  metrics: Metrics;
  geometrySource: string;
  scores: Record<ScoreKind, number>;
  scoreExplain: Record<string, { factors: Record<string, number | null>; weightsUsed: Record<string, number>; missingFactors: string[] }>;
  scoreCaveats: string[];
}

export interface Opportunity {
  id: string;
  postcode: string;
  name: string;
  region: string;
  kind: ScoreKind;
  score: number;
  scores: Record<ScoreKind, number>;
  explain: { factors: Record<string, number | null> };
  whySurfaced: string[];
  whyItMatters: string;
  questions: string[];
  customerDataRequired: string[];
  solutionHypotheses: string[];
  metrics: Metrics;
  geometrySource: string;
  centroid: [number, number];
}

export interface Source {
  id: string;
  name: string;
  publisher?: string;
  url?: string;
  license?: string | null;
  updated?: string | null;
  coverage?: string;
  fieldsUsed?: string[];
  limitations?: string;
  status: SourceStatus;
  note?: string | null;
  connectedDatasets?: string[];
}

export interface Bundle {
  networkId: string;
  generatedAt: string;
  disclaimer: string;
  notAffiliated: string;
  config: {
    name: string;
    description: string;
    jurisdiction: string;
    customersApproximate: string;
    serviceAreaSqKm: number;
    map: { defaultCenter: [number, number]; defaultZoom: number; focusView: { center: [number, number]; zoom: number; label: string } };
    focusPlaces: { id: string; name: string; kind: string; center: [number, number]; zoom: number; postcodes: string[] }[];
    scoring: Record<string, Record<string, number>>;
    notes: Record<string, string>;
  };
  account: {
    snapshot: Record<string, string | number | string[]>;
    themes: string[];
    topAreas: { postcode: string; name: string; region: string; scores: Record<ScoreKind, number> }[];
    suggestedConversations: string[];
    discoveryQuestions: Record<string, string[]>;
    dataGaps: Source[];
  };
  postcodes: PostcodeRecord[];
  opportunities: Opportunity[];
  sources: Source[];
  glossary: Record<string, string>;
  stats: Record<string, number | string | boolean | string[]>;
}

export const WORKSPACES: { id: WorkspaceId; label: string; hint: string }[] = [
  { id: "overview", label: "Network Overview", hint: "What does this territory look like?" },
  { id: "opportunity", label: "Opportunity Explorer", hint: "Where are interesting things happening?" },
  { id: "account", label: "Account Intelligence", hint: "Prepare for the customer meeting." },
  { id: "readiness", label: "Data Readiness", hint: "What would implementation actually require?" },
  { id: "scenario", label: "Scenario Lab", hint: "Strategic indicators only." },
  { id: "analyst", label: "Grid Analyst", hint: "Evidence-aware questions." },
  { id: "sources", label: "Evidence & Sources", hint: "Why am I seeing this?" },
];

export const SCORE_LABELS: Record<ScoreKind, string> = {
  flexibleExport: "Flexible Export",
  networkVisibility: "Network Visibility",
  connectionAssessment: "Connection Assessment",
  derOrchestration: "DER Orchestration",
  composite: "Composite",
};
