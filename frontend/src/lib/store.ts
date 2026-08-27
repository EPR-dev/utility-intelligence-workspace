"use client";

import { create } from "zustand";
import type { Bundle, PostcodeRecord, ScoreKind, WorkspaceId } from "./types";

export interface AppState {
  workspace: WorkspaceId;
  networkId: string;
  bundle: Bundle | null;
  error: string | null;
  loading: boolean;
  layers: Record<string, boolean>;
  selectedPostcode: string | null;
  comparePostcode: string | null;
  year: number;
  scoreKind: ScoreKind;
  search: string;
  bottomOpen: boolean;
  rectSelect: boolean;
  selectedSet: string[];
  meetingTopic: string;
  setWorkspace: (w: WorkspaceId) => void;
  setBundle: (b: Bundle) => void;
  setError: (e: string | null) => void;
  setLoading: (v: boolean) => void;
  toggleLayer: (id: string) => void;
  selectPostcode: (pc: string | null) => void;
  setCompare: (pc: string | null) => void;
  setYear: (y: number) => void;
  setScoreKind: (k: ScoreKind) => void;
  setSearch: (s: string) => void;
  setBottomOpen: (v: boolean) => void;
  setRectSelect: (v: boolean) => void;
  setSelectedSet: (ids: string[]) => void;
  setMeetingTopic: (t: string) => void;
}

export const useApp = create<AppState>((set) => ({
  workspace: "overview",
  networkId: "endeavour-energy",
  bundle: null,
  error: null,
  loading: true,
  layers: {
    territory: true,
    postcodes: true,
    zones: true,
    transmission: true,
    hv: false,
    industrial: false,
    commercial: false,
    ev: false,
  },
  selectedPostcode: "2577",
  comparePostcode: null,
  year: 2026,
  scoreKind: "flexibleExport",
  search: "",
  bottomOpen: false,
  rectSelect: false,
  selectedSet: [],
  meetingTopic: "general discovery",
  setWorkspace: (workspace) => set({ workspace }),
  setBundle: (bundle) => set({ bundle, loading: false, error: null }),
  setError: (error) => set({ error, loading: false }),
  setLoading: (loading) => set({ loading }),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  selectPostcode: (selectedPostcode) => set({ selectedPostcode }),
  setCompare: (comparePostcode) => set({ comparePostcode }),
  setYear: (year) => set({ year }),
  setScoreKind: (scoreKind) => set({ scoreKind }),
  setSearch: (search) => set({ search }),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
  setRectSelect: (rectSelect) => set({ rectSelect }),
  setSelectedSet: (selectedSet) => set({ selectedSet }),
  setMeetingTopic: (meetingTopic) => set({ meetingTopic }),
}));

export function selectedRecord(): PostcodeRecord | null {
  const { bundle, selectedPostcode } = useApp.getState();
  if (!bundle || !selectedPostcode) return null;
  return bundle.postcodes.find((p) => p.postcode === selectedPostcode) ?? null;
}
