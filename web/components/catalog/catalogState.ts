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
  zoom: 16,
  isDragging: false,
  activeId: null,
};

export const ui = {
  activeId: null as string | null,
  hoveredId: null as string | null,
  filter: "all" as "all" | "real",
};

/** Chain id for field → agent navigation. Set by FieldExperience. */
export let fieldChainId: string | null = null;

export function setFieldChainId(id: string | null) {
  fieldChainId = id;
}

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
  zoomDefault: 16,
  zoomOut: 48,
  zoomDamp: 0.22,
  /** Camera Z below this: full specimens. */
  lodSpecimen: 20,
  /** Camera Z above this: markers only. Between the two, they crossfade. */
  lodMarker: 32,
  /** Planar (XY) distance where a specimen begins fading to a marker. */
  planarFadeStart: 16,
  /** Planar distance where the specimen is gone and only the marker remains. */
  planarFadeEnd: 30,
  focusScale: 1.45,
  dimScale: 0.78,
  dimOpacity: 0.35,
  curvatureStrength: 0.05,
  fogNear: 14,
  fogFar: 60,
} as const;

export function resetRig() {
  rigState.target.set(0, 0, 0);
  rigState.current.set(0, 0, 0);
  rigState.velocity.set(0, 0, 0);
  rigState.zoom = CATALOG_CONFIG.zoomDefault;
  rigState.isDragging = false;
  rigState.activeId = null;
  ui.activeId = null;
  ui.hoveredId = null;
}
