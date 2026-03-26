"use client";

import { useState } from "react";
import styles from "./AdminSources.module.css";

interface Source {
  id: string;
  name: string;
  rss_url: string;
  home_url: string;
  language: string;
  created_at: string;
  article_count: number;
}

interface Props {
  initialSources: Source[];
}

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "mr", label: "Marathi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "bn", label: "Bengali" },
];

export default function AdminSources({ initialSources }: Props) {
  const [sources, setSources] = useState<Source[]>(initialSources);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    name: "",
    rss_url: "",
    home_url: "",
    language: "en",
  });

  const flash = (msg: string, type: "success" | "error") => {
    if (type === "success") { setSuccess(msg); setTimeout(() => setSuccess(""), 3000); }
    else { setError(msg); setTimeout(() => setError(""), 5000); }
  };

  const resetForm = () => {
    setForm({ name: "", rss_url: "", home_url: "", language: "en" });
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!form.name || !form.rss_url || !form.home_url) {
      flash("All fields are required.", "error");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        // Update existing source
        const res = await fetch("/api/sources", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingId, ...form }),
        });
        const data = await res.json();
        if (!res.ok) {
          flash(data.error ?? "Failed to update source.", "error");
        } else {
          setSources((prev) =>
            prev
              .map((s) =>
                s.id === editingId ? { ...s, ...data } : s
              )
              .sort((a, b) => a.name.localeCompare(b.name))
          );
          flash(`${data.name} updated successfully.`, "success");
          resetForm();
        }
      } else {
        // Add new source
        const res = await fetch("/api/sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) {
          flash(data.error ?? "Failed to add source.", "error");
        } else {
          setSources((prev) =>
            [...prev, { ...data, article_count: 0 }].sort((a, b) =>
              a.name.localeCompare(b.name)
            )
          );
          flash(`${data.name} added successfully.`, "success");
          resetForm();
        }
      }
    } catch {
      flash("Network error. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (source: Source) => {
    setForm({
      name: source.name,
      rss_url: source.rss_url,
      home_url: source.home_url,
      language: source.language,
    });
    setEditingId(source.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Remove "${name}"? This won't delete existing articles.`)) return;
    setDeleting(id);
    try {
      const res = await fetch("/api/sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSources((prev) => prev.filter((s) => s.id !== id));
        flash(`${name} removed.`, "success");
        if (editingId === id) {
          resetForm();
        }
      } else {
        flash("Failed to remove source.", "error");
      }
    } catch {
      flash("Network error.", "error");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <div>
            <a href="/feed" className={styles.backLink}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2L4 7l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Back to feed
            </a>
            <h1 className={styles.title}>News sources</h1>
            <p className={styles.subtitle}>{sources.length} sources · {sources.reduce((n, s) => n + s.article_count, 0)} summarised articles</p>
          </div>
        </div>

        {/* Toast messages */}
        {error && <div className={styles.toastError}>{error}</div>}
        {success && <div className={styles.toastSuccess}>{success}</div>}

        {/* Add / edit source form */}
        <div className={styles.addCard}>
          <h2 className={styles.addTitle}>{editingId ? "Edit source" : "Add new source"}</h2>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Source name</label>
              <input
                className={styles.input}
                placeholder="e.g. The Wire"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Language</label>
              <select
                className={styles.input}
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </div>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <label className={styles.label}>RSS feed URL</label>
              <input
                className={styles.input}
                placeholder="https://example.com/feed/"
                value={form.rss_url}
                onChange={(e) => setForm((f) => ({ ...f, rss_url: e.target.value }))}
                type="url"
              />
            </div>
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <label className={styles.label}>Homepage URL</label>
              <input
                className={styles.input}
                placeholder="https://example.com"
                value={form.home_url}
                onChange={(e) => setForm((f) => ({ ...f, home_url: e.target.value }))}
                type="url"
              />
            </div>
          </div>
          <div className={styles.formFooter}>
            <p className={styles.formHint}>
              The RSS URL will be tested before saving. Find RSS feeds by searching "[source name] RSS feed".
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              {editingId && (
                <button
                  type="button"
                  className={styles.addBtn}
                  onClick={resetForm}
                  style={{ background: "transparent", color: "var(--text-secondary)" }}
                >
                  Cancel
                </button>
              )}
              <button
                className={styles.addBtn}
                onClick={handleSubmit}
                disabled={saving}
              >
                {saving ? (editingId ? "Saving…" : "Checking URL…") : editingId ? "Save changes" : "Add source"}
              </button>
            </div>
          </div>
        </div>

        {/* Source list */}
        <div className={styles.sourceList}>
          {sources.map((source) => (
            <div key={source.id} className={styles.sourceRow}>
              <div className={styles.sourceInfo}>
                <div className={styles.sourceName}>{source.name}</div>
                <a
                  href={source.rss_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.sourceUrl}
                >
                  {source.rss_url.replace(/^https?:\/\//, "").slice(0, 55)}
                  {source.rss_url.length > 62 ? "…" : ""}
                </a>
              </div>
              <div className={styles.sourceMeta}>
                <span className={styles.sourceLang}>{source.language}</span>
                <span className={styles.sourceCount}>
                  {source.article_count} articles
                </span>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleEditClick(source)}
                  aria-label={`Edit ${source.name}`}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 11l2.5-.5L11 5l-2-2L3.5 8.5 3 11z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(source.id, source.name)}
                  disabled={deleting === source.id}
                  aria-label={`Remove ${source.name}`}
                >
                  {deleting === source.id ? (
                    <span className={styles.spinner} />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M2 3.5h10M5.5 3.5V2.5h3V3.5M5 3.5l.5 8M9 3.5l-.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
