"use client";

import { useState } from "react";
import { HireMaxPanel } from "@/components/HireMaxPanel";
import { useI18n } from "@/lib/i18n";

type Props = {
  onImported: () => void;
  onFlash: (msg: string) => void;
};

const PLACEHOLDER = `[
  {
    "company": "",
    "role": "",
    "region": "europe",
    "url": "",
    "description": ""
  }
]
`;

export function HarvestPanel({ onImported, onFlash }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(payload: { text?: string }) {
    setBusy(true);
    try {
      const res = await fetch("/api/harvest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        added?: number;
        skipped?: number;
        errors?: string[];
      };
      if (!res.ok || !data.ok) {
        onFlash(t("harvest.fail"));
        return;
      }
      onFlash(
        t("harvest.paste_ok", {
          added: data.added ?? 0,
          skipped: data.skipped ?? 0,
        }),
      );
      setText("");
      onImported();
    } catch {
      onFlash(t("harvest.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="harvest-panel">
      <HireMaxPanel
        onFilled={() => {
          onImported();
          onFlash(t("harvest.done"));
        }}
      />

      <div className="harvest-panel__manual">
        <div className="hd-rail eu" style={{ margin: "1.25rem 0 1rem" }}>
          <h2>{t("harvest.manual")}</h2>
          <p>{t("harvest.manual_hint")}</p>
        </div>
        <textarea
          className="harvest-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={PLACEHOLDER}
        />
        <div
          className="job-actions"
          style={{ border: "none", paddingTop: "0.85rem" }}
        >
          <button
            type="button"
            className="primary"
            disabled={busy || !text.trim()}
            onClick={() => void run({ text })}
          >
            {busy ? t("harvest.importing") : t("harvest.import")}
          </button>
        </div>
      </div>
    </div>
  );
}
