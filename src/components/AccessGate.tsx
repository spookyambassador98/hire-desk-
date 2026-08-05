"use client";

import { useState } from "react";
import { motion } from "framer-motion";

const STORAGE_KEY = "apex-hire-unlocked";

type Props = {
  onUnlock: () => void;
};

export function AccessGate({ onUnlock }: Props) {
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
    setError(
        res.status === 503
          ? "Задай HIRE_DESK_ACCESS_CODE в .env.local"
          : "Неверный код",
      );
        return;
      }
      sessionStorage.setItem(STORAGE_KEY, "1");
      onUnlock();
    } catch {
      setError("Ошибка сети");
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
        <div className="access-gate__kicker">APEX // HIRE LOCK</div>
        <h2 className="access-gate__title">Hire Desk</h2>
        <p className="access-gate__hint">
          Код доступа. По умолчанию: APEX-HIRE
        </p>
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
          {busy ? "Проверка…" : "Unlock"}
        </button>
      </motion.form>
    </motion.div>
  );
}

export function isHireUnlocked() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}
