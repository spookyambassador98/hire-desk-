"use client";

import { useState } from "react";
import type { ApplyChannel, Region } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddJobModal({ open, onClose, onCreated }: Props) {
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [region, setRegion] = useState<Region>("europe");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [location, setLocation] = useState("");
  const [salaryMin, setSalaryMin] = useState("");
  const [salaryMax, setSalaryMax] = useState("");
  const [channel, setChannel] = useState<ApplyChannel>("other");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const min = salaryMin ? Number(salaryMin) : null;
      const max = salaryMax ? Number(salaryMax) : null;
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          role,
          region,
          description,
          url: url || null,
          location: location || null,
          channel,
          salary:
            min != null || max != null
              ? {
                  min,
                  max,
                  currency: region === "europe" ? "EUR" : "USD",
                  period: "year",
                }
              : null,
        }),
      });
      if (!res.ok) {
        setError("Не удалось сохранить");
        return;
      }
      setCompany("");
      setRole("");
      setDescription("");
      setUrl("");
      setLocation("");
      setSalaryMin("");
      setSalaryMax("");
      onCreated();
      onClose();
    } catch {
      setError("Ошибка сети");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form
        className="modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h3>Add vacancy</h3>
        <label>
          Company
          <input
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label>
          Role
          <input
            required
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <label>
          Region
          <select
            value={region}
            onChange={(e) => setRegion(e.target.value as Region)}
          >
            <option value="europe">Europe</option>
            <option value="america">America</option>
          </select>
        </label>
        <label>
          Location
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Remote EU / NYC"
          />
        </label>
        <label>
          Description
          <textarea
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label>
          Apply URL
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <label>
          Channel
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ApplyChannel)}
          >
            <option value="ashby">Ashby</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="careers">Careers</option>
            <option value="linkedin_easy">LinkedIn Easy</option>
            <option value="linkedin">LinkedIn</option>
            <option value="wellfound">Wellfound</option>
            <option value="other">Other</option>
            <option value="none">None</option>
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <label>
            Salary min
            <input
              inputMode="numeric"
              value={salaryMin}
              onChange={(e) => setSalaryMin(e.target.value)}
            />
          </label>
          <label>
            Salary max
            <input
              inputMode="numeric"
              value={salaryMax}
              onChange={(e) => setSalaryMax(e.target.value)}
            />
          </label>
        </div>
        {error && <div className="access-gate__error">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
