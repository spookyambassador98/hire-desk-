"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AccessGate, isHireUnlocked } from "@/components/AccessGate";
import { HireDesk } from "@/components/HireDesk";
import { HireAtmosphere } from "@/components/motion/HireAtmosphere";
import { HireIntro } from "@/components/motion/HireIntro";
import { I18nProvider } from "@/lib/i18n";
import type {
  QuotaSnapshot,
  ScoredIndividual,
  ScoredJob,
} from "@/lib/types";

type Phase = "intro" | "gate" | "app";

type Props = {
  initialJobs: ScoredJob[];
  initialIndividuals: ScoredIndividual[];
  initialQuota: QuotaSnapshot;
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function AppShell({
  initialJobs,
  initialIndividuals,
  initialQuota,
}: Props) {
  const [phase, setPhase] = useState<Phase>("intro");

  const onIntroDone = useCallback(() => {
    if (isHireUnlocked()) setPhase("app");
    else setPhase("gate");
  }, []);

  return (
    <I18nProvider>
      <HireAtmosphere />
      <AnimatePresence mode="wait">
        {phase === "intro" && (
          <HireIntro key="intro" onDone={onIntroDone} />
        )}
        {phase === "gate" && (
          <motion.div
            key="gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
          >
            <AccessGate onUnlock={() => setPhase("app")} />
          </motion.div>
        )}
        {phase === "app" && (
          <motion.div
            key="app"
            initial={{ opacity: 0, clipPath: "inset(12% 8% 12% 8%)" }}
            animate={{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)" }}
            transition={{ duration: 0.85, ease: EASE }}
          >
            <HireDesk
              initialJobs={initialJobs}
              initialIndividuals={initialIndividuals}
              initialQuota={initialQuota}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </I18nProvider>
  );
}
