"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  initialLeftPercent?: number;
}

export function ResizablePanels({ left, right, initialLeftPercent = 40 }: ResizablePanelsProps) {
  const [leftPercent, setLeftPercent] = useState(initialLeftPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPercent(Math.min(80, Math.max(20, percent)));
  }, []);

  const stopDragging = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDragging);
  }, [onPointerMove]);

  const startDragging = useCallback(() => {
    dragging.current = true;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
  }, [onPointerMove, stopDragging]);

  return (
    <div ref={containerRef} style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ width: `${leftPercent}%`, overflow: "auto" }}>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDragging}
        style={{ width: 6, cursor: "col-resize", background: "var(--panel-divider, #ccc)" }}
      />
      <div style={{ width: `${100 - leftPercent}%`, overflow: "auto" }}>{right}</div>
    </div>
  );
}
