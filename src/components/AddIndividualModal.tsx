"use client";

import { useState } from "react";
import type { IndividualKind, Region } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddIndividualModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [kind, setKind] = useState<IndividualKind>("hiring_manager");
  const [region, setRegion] = useState<Region>("europe");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [title, setTitle] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/individuals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          company,
          kind,
          region,
          email: email || null,
          linkedin: linkedin || null,
          title: title || null,
          targetRole: targetRole || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        setError("Не удалось сохранить");
        return;
      }
      setName("");
      setCompany("");
      setEmail("");
      setLinkedin("");
      setTitle("");
      setTargetRole("");
      setNotes("");
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
        <h3>Add individual</h3>
        <label>
          Name
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Company
          <input
            required
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label>
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as IndividualKind)}
          >
            <option value="hiring_manager">Hiring Manager</option>
            <option value="hr">HR</option>
            <option value="senior_eng">Senior Eng</option>
            <option value="founder">Founder</option>
            <option value="recruiter">Recruiter</option>
            <option value="other">Other</option>
          </select>
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
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Target role
          <input
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="Founding Engineer…"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          LinkedIn URL
          <input
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
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
