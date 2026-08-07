"use client";

import { useEffect } from "react";

function isBlockedShortcut(e: KeyboardEvent) {
  const key = e.key.toLowerCase();
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  const shift = e.shiftKey;
  const alt = e.altKey;

  if (e.key === "F12") return true;
  if (ctrlOrMeta && shift && ["i", "j", "c", "k"].includes(key)) return true;
  if (e.metaKey && alt && ["i", "j", "c"].includes(key)) return true;
  if (ctrlOrMeta && !shift && !alt && ["u", "s"].includes(key)) return true;
  return false;
}

/** Blocks context menu + common view-source / DevTools shortcuts. */
export function DisableContextMenu() {
  useEffect(() => {
    const onContextMenu = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isBlockedShortcut(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("dragstart", onDragStart, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("dragstart", onDragStart, true);
    };
  }, []);
  return null;
}
