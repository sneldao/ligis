"use client";

import { useSyncExternalStore } from "react";
import { Vector3 } from "three";

export type CatalogState = {
  target: Vector3;
  current: Vector3;
  velocity: Vector3;
  zoom: number;
  isDragging: boolean;
  activeId: string | null;
};

const listeners = new Set<() => void>();

export const rigState: CatalogState = {
  target: new Vector3(0, 0, 0),
  current: new Vector3(0, 0, 0),
  velocity: new Vector3(0, 0, 0),
  zoom: 28,
  isDragging: false,
  activeId: null,
};

export const ui = {
  activeId: null as string | null,
  hoveredId: null as string | null,
  filter: "all" as "all" | "real",
};

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return ui;
}

export function setActiveId(id: string | null) {
  ui.activeId = id;
  rigState.activeId = id;
  notify();
}

export function setHoveredId(id: string | null) {
  ui.hoveredId = id;
  notify();
}

export function setFilter(filter: "all" | "real") {
  ui.filter = filter;
  notify();
}

export function useCatalogUi() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const CATALOG_CONFIG = {
  gridCols: 7,
  itemSize: 2.6,
  gap: 0.7,
  dragSpeed: 1.9,
  dampFactor: 0.18,
  tiltFactor: 0.07,
  clickThreshold: 6,
  dragResistance: 0.22,
  zoomIn: 10,
  zoomOut: 28,
  zoomDamp: 0.22,
  focusScale: 1.45,
  dimScale: 0.78,
  dimOpacity: 0.35,
  curvatureStrength: 0.05,
  fogNear: 14,
  fogFar: 60,
} as const;
