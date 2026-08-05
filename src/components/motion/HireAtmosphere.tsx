"use client";

import { motion } from "framer-motion";

/** Ambient dual-rail field — not Lead Desk's 3D HudScene. */
export function HireAtmosphere() {
  return (
    <div className="hire-atmo" aria-hidden>
      <motion.div
        className="hire-atmo__orb hire-atmo__orb--eu"
        animate={{
          opacity: [0.35, 0.55, 0.35],
          scale: [1, 1.08, 1],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="hire-atmo__orb hire-atmo__orb--us"
        animate={{
          opacity: [0.28, 0.48, 0.28],
          scale: [1.05, 1, 1.05],
        }}
        transition={{ duration: 9.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="hire-atmo__scan"
        animate={{ y: ["-20%", "120%"] }}
        transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
      />
      <div className="hire-atmo__ring hire-atmo__ring--a" />
      <div className="hire-atmo__ring hire-atmo__ring--b" />
    </div>
  );
}
