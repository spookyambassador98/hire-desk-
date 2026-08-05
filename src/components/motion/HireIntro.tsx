"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

type Props = {
  onDone: () => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;
const WORD = "GET HIRED";

/**
 * Hire Desk boot — deliberately NOT Lead Desk's GSAP APEX flash.
 * Dual-rail collision: cyan (EU) × gold (US) → GET HIRED stamp → peel away.
 */
export function HireIntro({ onDone }: Props) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"boot" | "out">("boot");

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    const hold = window.setTimeout(() => setPhase("out"), 2500);
    const done = window.setTimeout(() => onDone(), 3300);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [onDone, reduced]);

  if (reduced) return null;

  const letters = WORD.split("");

  return (
    <motion.div
      className="hire-intro"
      initial={{ opacity: 1 }}
      animate={
        phase === "out"
          ? { opacity: 0, scale: 1.04, filter: "blur(12px)" }
          : { opacity: 1, scale: 1, filter: "blur(0px)" }
      }
      transition={{ duration: 0.65, ease: EASE }}
    >
      <div className="hire-intro__grid" aria-hidden />

      <motion.div
        className="hire-intro__shutter hire-intro__shutter--eu"
        initial={{ x: "-100%" }}
        animate={{ x: phase === "out" ? "-105%" : "0%" }}
        transition={{ duration: phase === "out" ? 0.75 : 0.9, ease: EASE }}
      />
      <motion.div
        className="hire-intro__shutter hire-intro__shutter--us"
        initial={{ x: "100%" }}
        animate={{ x: phase === "out" ? "105%" : "0%" }}
        transition={{ duration: phase === "out" ? 0.75 : 0.9, ease: EASE }}
      />

      <motion.div
        className="hire-intro__seam"
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{
          scaleY: phase === "out" ? 0 : 1,
          opacity: phase === "out" ? 0 : 1,
        }}
        transition={{ delay: 0.55, duration: 0.45, ease: EASE }}
      />

      <div className="hire-intro__stage">
        <motion.p
          className="hire-intro__kicker"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: phase === "out" ? 0 : 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          APEX // CAREER OPS
        </motion.p>

        <h1 className="hire-intro__word" aria-label="GET HIRED">
          {letters.map((ch, i) => {
            const fromLeft = i < 4;
            return (
              <motion.span
                key={`${ch}-${i}`}
                initial={{
                  opacity: 0,
                  x: fromLeft ? -72 : 72,
                  rotateY: fromLeft ? -48 : 48,
                  filter: "blur(10px)",
                }}
                animate={{
                  opacity: phase === "out" ? 0 : 1,
                  x: 0,
                  rotateY: 0,
                  filter: "blur(0px)",
                  y: phase === "out" ? (fromLeft ? -36 : 36) : 0,
                }}
                transition={{
                  delay: 0.5 + i * 0.055,
                  duration: 0.55,
                  ease: EASE,
                }}
              >
                {ch === " " ? "\u00A0" : ch}
              </motion.span>
            );
          })}
        </h1>

        <motion.div
          className="hire-intro__stamp"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{
            scaleX: phase === "out" ? 0 : 1,
            opacity: phase === "out" ? 0 : 1,
          }}
          transition={{ delay: 1.05, duration: 0.4, ease: EASE }}
        />

        <motion.p
          className="hire-intro__sub"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "out" ? 0 : 1 }}
          transition={{ delay: 1.2, duration: 0.4 }}
        >
          EUROPE × AMERICA · PORTFOLIO FIT · DAILY QUEUE
        </motion.p>
      </div>
    </motion.div>
  );
}
