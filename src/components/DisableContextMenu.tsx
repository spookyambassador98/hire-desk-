"use client";

import { useEffect } from "react";

/** Blocks the browser context menu everywhere in the demo. */
export function DisableContextMenu() {
  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("contextmenu", block, true);
    return () => document.removeEventListener("contextmenu", block, true);
  }, []);
  return null;
}
