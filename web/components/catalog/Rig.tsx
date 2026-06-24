"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import { easing } from "maath";
import { CATALOG_CONFIG, rigState } from "./catalogState";

const IDLE_DELAY_MS = 5500;
const IDLE_RADIUS = 2.6;
const IDLE_SPEED = 0.13;

const KEY_FORWARD = ["w", "W", "ArrowUp"];
const KEY_BACK = ["s", "S", "ArrowDown"];
const KEY_LEFT = ["a", "A", "ArrowLeft"];
const KEY_RIGHT = ["d", "D", "ArrowRight"];
const KEY_UP = ["e", "E"];
const KEY_DOWN = ["q", "Q"];

const KEY_PAN_SPEED = 16;
const KEY_Z_SPEED = 12;

export function Rig() {
  const { camera, gl } = useThree();
  const prevPos = useRef(new Vector3());
  const lastInteract = useRef(performance.now());
  const idleAnchor = useRef<{ x: number; y: number } | null>(null);
  const idlePhase = useRef(Math.random() * Math.PI * 2);
  const keys = useRef({
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
  });
  const pointer = useRef({ x: 0, y: 0 });

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

    const markActive = () => {
      lastInteract.current = performance.now();
      idleAnchor.current = null;
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
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      pointer.current.x = nx;
      pointer.current.y = ny;

      if (!isDown) return;
      markActive();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
      if (maxDist > CATALOG_CONFIG.clickThreshold) {
        rigState.isDragging = true;
      }
      const vFov = (cam.fov * Math.PI) / 180;
      const visibleHeight = 2 * Math.tan(vFov / 2) * cam.position.z;
      const sensitivity = (visibleHeight / window.innerHeight) * CATALOG_CONFIG.dragSpeed;
      const tx = initialX + dx * sensitivity;
      const ty = initialY - dy * sensitivity;
      rigState.target.set(tx, ty, 0);
    };

    const onUp = () => {
      if (!isDown) return;
      isDown = false;
      rigState.isDragging = false;
      canvas.style.cursor = "grab";
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      markActive();
      rigState.zoom = Math.max(
        CATALOG_CONFIG.zoomIn,
        Math.min(CATALOG_CONFIG.zoomOut + 14, rigState.zoom + e.deltaY * 0.02)
      );
    };

    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (inField) return;

      const k = e.key;
      if (KEY_FORWARD.includes(k)) keys.current.forward = down;
      else if (KEY_BACK.includes(k)) keys.current.back = down;
      else if (KEY_LEFT.includes(k)) keys.current.left = down;
      else if (KEY_RIGHT.includes(k)) keys.current.right = down;
      else if (KEY_UP.includes(k)) keys.current.up = down;
      else if (KEY_DOWN.includes(k)) keys.current.down = down;
      else return;

      if (down) markActive();
      e.preventDefault();
    };

    const keyDownHandler = onKey(true);
    const keyUpHandler = onKey(false);

    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", keyDownHandler);
    window.addEventListener("keyup", keyUpHandler);

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", keyDownHandler);
      window.removeEventListener("keyup", keyUpHandler);
    };
  }, [gl, camera]);

  useFrame((_state, delta) => {
    const k = keys.current;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    if (k.right) dx += 1;
    if (k.left) dx -= 1;
    if (k.up) dy += 1;
    if (k.down) dy -= 1;
    if (k.forward) dz -= 1;
    if (k.back) dz += 1;

    if (dx || dy) {
      rigState.target.x += dx * KEY_PAN_SPEED * delta;
      rigState.target.y += dy * KEY_PAN_SPEED * delta;
    }
    if (dz) {
      rigState.zoom = Math.max(
        CATALOG_CONFIG.zoomIn,
        Math.min(CATALOG_CONFIG.zoomOut + 14, rigState.zoom + dz * KEY_Z_SPEED * delta)
      );
    }

    const idleFor = (performance.now() - lastInteract.current) / 1000;
    if (
      idleFor > IDLE_DELAY_MS / 1000 &&
      rigState.activeId === null &&
      !rigState.isDragging
    ) {
      if (!idleAnchor.current) {
        idleAnchor.current = { x: rigState.target.x, y: rigState.target.y };
        idlePhase.current = Math.random() * Math.PI * 2;
      }
      idlePhase.current += delta * IDLE_SPEED;
      const driftX = idleAnchor.current.x + Math.cos(idlePhase.current) * IDLE_RADIUS;
      const driftY =
        idleAnchor.current.y + Math.sin(idlePhase.current * 0.73) * IDLE_RADIUS * 0.6;
      easing.damp(rigState.target, "x", driftX, 0.6, delta);
      easing.damp(rigState.target, "y", driftY, 0.6, delta);
    }

    easing.damp3(rigState.current, rigState.target, CATALOG_CONFIG.dampFactor, delta);
    easing.damp(camera.position, "z", rigState.zoom, CATALOG_CONFIG.zoomDamp, delta);
    rigState.velocity.copy(rigState.current).sub(prevPos.current);
    prevPos.current.copy(rigState.current);

    const zoomFactor = Math.min(1, CATALOG_CONFIG.zoomIn / rigState.zoom);
    const dragTiltX = rigState.velocity.y * CATALOG_CONFIG.tiltFactor * zoomFactor;
    const dragTiltY = -rigState.velocity.x * CATALOG_CONFIG.tiltFactor * zoomFactor;
    const parallaxX = pointer.current.y * 0.04;
    const parallaxY = -pointer.current.x * 0.06;

    easing.damp(camera.rotation, "x", dragTiltX + parallaxX, 0.22, delta);
    easing.damp(camera.rotation, "y", dragTiltY + parallaxY, 0.22, delta);

    camera.position.x = rigState.current.x;
    camera.position.y = rigState.current.y;
  });

  return null;
}
