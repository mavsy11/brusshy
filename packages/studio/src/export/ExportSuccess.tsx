import { useEffect, useRef, useState } from "react";
import { api } from "../lib/socket";
import { copyText } from "../lib/notes";
import { toast, useStore } from "../lib/store";
import { formatBytes } from "./util";
import { dismissExportDone, useExportDone } from "./success";
import "./success.css";

const SHOW_MS = 9000;

const I = {
  check: (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <path d="M2 4.5c0-.6.4-1 1-1h3l1.4 1.6H13c.6 0 1 .4 1 1v6.4c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
    </svg>
  ),
  copy: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="5" width="8.5" height="8.5" rx="1.6" />
      <path d="M11 3.2V3c0-.8-.6-1.4-1.4-1.4H3.4C2.6 1.6 2 2.2 2 3v6.2c0 .8.6 1.4 1.4 1.4h.2" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
};

/** A quiet card after an export: what was made, where it went, and a way to get to it. */
export function ExportSuccess() {
  const card = useExportDone((s) => s.card);
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setCopied(false), [card?.id]);

  // Auto-dismiss, paused while the pointer is on the card.
  useEffect(() => {
    clearTimeout(timer.current);
    if (!card || hover) return;
    timer.current = setTimeout(dismissExportDone, SHOW_MS);
    return () => clearTimeout(timer.current);
  }, [card, hover]);

  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !useStore.getState().exportOpen && dismissExportDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  if (!card) return null;

  const reveal = async () => {
    if (!card.dir) return;
    try {
      const r = await api<{ ok: boolean }>("/api/export/reveal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: card.dir.split(/[\\/]/).pop() }),
      });
      if (!r.ok) toast("Couldn't open the folder", "error");
    } catch (e) {
      toast((e as Error).message || "Couldn't open the folder", "error");
    }
  };

  const copyPath = async () => {
    if (!card.dir) return;
    if (await copyText(card.dir)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  const title = `${card.by === "ai" ? "Your AI exported" : "Exported"} ${card.count} file${card.count === 1 ? "" : "s"}`;

  return (
    <div
      key={card.id}
      className={`panel xd${hover ? " hold" : ""}`}
      data-ui
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ ["--xd-ms" as string]: `${SHOW_MS}ms` }}
    >
      <div className={`xd-thumb${card.thumb ? "" : " skeleton"}`}>{card.thumb && <img src={card.thumb} alt="" />}</div>
      <div className="xd-body">
        <div className="xd-title">
          <span className="xd-ok">{I.check}</span>
          {title}
        </div>
        <div className="xd-sub">
          <code title={card.dir ?? card.where}>{card.dir ? `exports/${card.dir.split(/[\\/]/).pop()}` : card.where}</code>
          <span className="xd-dot">·</span>
          <span>{formatBytes(card.bytes)}</span>
          {card.failed > 0 && <span className="xd-failed"> · {card.failed} failed</span>}
        </div>
        <div className="xd-actions">
          {card.mode === "save" && card.dir ? (
            <>
              <button className="btn small" onClick={() => void reveal()}>
                {I.folder}
                Reveal folder
              </button>
              <button className="btn small ghost" onClick={() => void copyPath()}>
                {copied ? I.check : I.copy}
                {copied ? "Copied" : "Copy path"}
              </button>
            </>
          ) : (
            <span className="xd-note">Saved to your downloads</span>
          )}
          <span className="grow" />
          <button className="btn small ghost" onClick={() => (dismissExportDone(), useStore.setState({ exportOpen: true }))}>
            Export again
          </button>
        </div>
      </div>
      <button className="icon-btn xd-close" aria-label="Dismiss" onClick={dismissExportDone}>
        {I.close}
      </button>
      <span className="xd-timer" aria-hidden />
    </div>
  );
}
