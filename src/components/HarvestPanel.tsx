"use client";

import { useState } from "react";
import { HireMaxPanel } from "@/components/HireMaxPanel";

type Props = {
  onImported: () => void;
  onFlash: (msg: string) => void;
};

const PLACEHOLDER = `[
  {
    "company": "Acme",
    "role": "Product Engineer",
    "region": "europe",
    "url": "https://...",
    "description": "..."
  }
]

# or CSV:
# company,role,region,url,description`;

export function HarvestPanel({ onImported, onFlash }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(payload: { text?: string; useSample?: boolean }) {
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
        onFlash("Paste import failed");
        return;
      }
      onFlash(
        `Paste +${data.added ?? 0} · skip ${data.skipped ?? 0}${
          data.errors?.length ? ` · err ${data.errors.length}` : ""
        }`,
      );
      setText("");
      onImported();
    } catch {
      onFlash("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="harvest-panel">
      <HireMaxPanel
        onFilled={() => {
          onImported();
          onFlash("MAX LIVE finished — Queue refreshed");
        }}
      />

      <div className="hd-rail eu" style={{ margin: "1.25rem 0 1rem" }}>
        <h2>Manual paste / CSV</h2>
        <p>
          Fallback hatch. JSON array, NDJSON, or CSV. LinkedIn = import file
          only (no scrape).
        </p>
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
          {busy ? "Importing…" : "Import paste"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run({ useSample: true })}
        >
          Import sample pack
        </button>
      </div>
    </div>
  );
}
