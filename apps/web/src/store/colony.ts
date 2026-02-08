import { create } from 'zustand';
import type { ColonyEvent } from '../colony/types';

interface ColonyState {
  selectedPawnId: string | null;
  hoveredPawnId: string | null;
  simulationSpeed: number; // 0 (paused), 1, 2, 3
  zoomLevel: number;
  recentEvents: ColonyEvent[];

  // Actions
  selectPawn: (id: string | null) => void;
  setHoveredPawn: (id: string | null) => void;
  setSpeed: (speed: number) => void;
  setZoom: (zoom: number) => void;
  addEvent: (event: ColonyEvent) => void;
  clearEvents: () => void;
}

export const useColonyStore = create<ColonyState>()((set) => ({
  selectedPawnId: null,
  hoveredPawnId: null,
  simulationSpeed: 1,
  zoomLevel: 1,
  recentEvents: [],

  selectPawn: (id) => set({ selectedPawnId: id }),
  setHoveredPawn: (id) => set({ hoveredPawnId: id }),
  setSpeed: (speed) => set({ simulationSpeed: speed }),
  setZoom: (zoom) => set({ zoomLevel: zoom }),

  addEvent: (event) =>
    set((state) => ({
      recentEvents: [event, ...state.recentEvents].slice(0, 50),
    })),

  clearEvents: () => set({ recentEvents: [] }),
}));
