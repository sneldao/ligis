"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { easing } from "maath";
import { CATALOG_CONFIG, rigState } from "./catalogState";

const IDLE_DELAY_MS = 6000;
const IDLE_RADIUS = 1.4;
const IDLE_SPEED = 0.18;

export function Rig({ gridW, gridH }: { gridW: number; gridH: number }) {
  const { camera, gl } = useThree();
  const prevPos = useRef(new Vector3());
  const lastInteract = useRef(performance.now());
  const idlePhase = useRef(Math.random() * Math.PI * 2);

  useEffect(() => {
    camera.position.z = rigState.zoom;
  }, [camera]);

  useEffect(() => {
    const canvas = gl.domElement;
    let isDown = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let initialY = 0;
    let maxDist = 0;

    const cam = camera as { fov: number; aspect: number; position: Vector3 };

    const getBounds = () => {
      const dist = cam.position.z;
      const vFov = (cam.fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(vFov / 2) * dist;
      const visibleWidth = visibleHeight * cam.aspect;
      const xLimit = Math.max(0, (gridW - visibleWidth) / 2 + 2);
      const yLimit = Math.max(0, (gridH - visibleHeight) / 2 + 2);
      return { x: xLimit, y: yLimit, visibleHeight };
    };

    const markActive = () => {
      lastInteract.current = performance.now();
    };

    const onDown = (e: PointerEvent) => {
      isDown = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = rigState.target.x;
      initialY = rigState.target.y;
      maxDist = 0;
      rigState.isDragging = false;
      canvas.style.cursor = "grabbing";
      markActive();
    };

    const onMove = (e: PointerEvent) => {
      if (!isDown) return;
      markActive();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
      if (maxDist > CATALOG_CONFIG.clickThreshold) {
        rigState.isDragging = true;
      }
      const { x: bx, y: by, visibleHeight } = getBounds();
      const sensitivity = (visibleHeight / window.innerHeight) * CATALOG_CONFIG.dragSpeed;
      let tx = initialX + dx * sensitivity;
      let ty = initialY - dy * sensitivity;
      if (tx > bx) tx = bx + (tx - bx) * CATALOG_CONFIG.dragResistance;
      if (tx < -bx) tx = -bx + (tx + bx) * CATALOG_CONFIG.dragResistance;
      if (ty > by) ty = by + (ty - by) * CATALOG_CONFIG.dragResistance;
      if (ty < -by) ty = -by + (ty + by) * CATALOG_CONFIG.dragResistance;
      const max = 3;
      tx = Math.max(-bx - max, Math.min(bx + max, tx));
      ty = Math.max(-by - max, Math.min(by + max, ty));
      rigState.target.set(tx, ty, 0);
    };

    const onUp = () => {
      if (!isDown) return;
      isDown = false;
      rigState.isDragging = false;
      canvas.style.cursor = "grab";
      if (rigState.activeId !== null) return;
      const { x: bx, y: by } = getBounds();
      const isZoomedOut = cam.position.z > CATALOG_CONFIG.zoomIn + 2;
      const snapX = isZoomedOut ? 0 : Math.max(-bx, Math.min(bx, rigState.target.x));
      const snapY = isZoomedOut ? 0 : Math.max(-by, Math.min(by, rigState.target.y));
      rigState.target.set(snapX, snapY, 0);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markActive();
      const next = Math.max(
        CATALOG_CONFIG.zoomIn,
        Math.min(CATALOG_CONFIG.zoomOut + 12, rigState.zoom + e.deltaY * 0.02)
      );
      rigState.zoom = next;
    };

    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [gl, camera, gridW, gridH]);

  useFrame((_state, delta) => {
    const idleFor = (performance.now() - lastInteract.current) / 1000;
    if (idleFor > IDLE_DELAY_MS / 1000 && rigState.activeId === null && !rigState.isDragging) {
      idlePhase.current += delta * IDLE_SPEED;
      const driftX = Math.cos(idlePhase.current) * IDLE_RADIUS;
      const driftY = Math.sin(idlePhase.current * 0.73) * IDLE_RADIUS * 0.5;
      rigState.target.set(driftX, driftY, 0);
    }

    easing.damp3(rigState.current, rigState.target, CATALOG_CONFIG.dampFactor, delta);
    easing.damp(camera.position, "z", rigState.zoom, CATALOG_CONFIG.zoomDamp, delta);
    rigState.velocity.copy(rigState.current).sub(prevPos.current);
    prevPos.current.copy(rigState.current);

    const zoomFactor = Math.min(1, CATALOG_CONFIG.zoomIn / rigState.zoom);
    const tiltX = rigState.velocity.y * CATALOG_CONFIG.tiltFactor * zoomFactor;
    const tiltY = -rigState.velocity.x * CATALOG_CONFIG.tiltFactor * zoomFactor;
    easing.damp(camera.rotation, "x", tiltX, 0.2, delta);
    easing.damp(camera.rotation, "y", tiltY, 0.2, delta);

    camera.position.x = rigState.current.x;
    camera.position.y = rigState.current.y;
  });

  return null;
}
