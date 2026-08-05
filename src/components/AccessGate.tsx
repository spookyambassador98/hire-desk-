"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { useI18n } from "@/lib/i18n";

const STORAGE_KEY = "apex-hire-unlocked";

type Props = {
  onUnlock: () => void;
};

export function AccessGate({ onUnlock }: Props) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          res.status === 503 || data.error === "access_not_configured"
            ? t("gate.not_configured")
            : t("gate.bad_code"),
        );
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, "1");
      onUnlock();
    } catch {
      setError(t("gate.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="access-gate"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.form
        className="access-gate__panel"
        onSubmit={(e) => void submit(e)}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 280, damping: 28 }}
      >
        <div className="access-gate__kicker">{t("gate.kicker")}</div>
        <h2 className="access-gate__title">{t("gate.title")}</h2>
        <p className="access-gate__hint">{t("gate.hint")}</p>
        <label className="access-gate__field">
          <input
            type="password"
            autoFocus
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="••••••••••"
          />
        </label>
        {error && <div className="access-gate__error">{error}</div>}
        <button
          type="submit"
          className="access-gate__btn"
          disabled={busy || !code.trim()}
        >
          {busy ? t("gate.checking") : t("gate.unlock")}
        </button>
      </motion.form>
    </motion.div>
  );
}

export function isHireUnlocked() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}
