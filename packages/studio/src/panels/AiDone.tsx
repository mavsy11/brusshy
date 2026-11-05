import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";

/**
 * A quiet "done" pill above the chat when an AI run finishes — from the canvas chat or
 * from an agent working through MCP in a terminal. Shown for a moment, then it tucks away.
 */

const SHOW_MS = 2800;

function fmt(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AiDone() {
  const busy = useStore((s) => !!s.chat?.busy);
  const working = useStore((s) => s.agent.state === "working");
  const [shown, setShown] = useState<{ id: number; label: string } | null>(null);
  const prev = useRef({ busy, working, since: 0 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const p = prev.current;
    const now = Date.now();
    let label: string | null = null;
    if (p.busy && !busy) {
      // The chat run ended: celebrate only a clean finish (errors and Stop already say so in the thread).
      const last = [...(useStore.getState().chat?.messages ?? [])].reverse().find((m) => m.role === "assistant");
      if (last?.status === "done") label = `Done${last.ms ? ` in ${fmt(last.ms)}` : ""}`;
    } else if (p.working && !working && !busy) {
      const a = useStore.getState().agent;
      const started = a.startedAt ?? p.since;
      label = `Your AI finished${started ? ` · ${fmt(now - started)}` : ""}`;
    }
    if (!p.working && working) p.since = now;
    p.busy = busy;
    p.working = working;
    if (!label) return;
    setShown({ id: now, label });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), SHOW_MS);
  }, [busy, working]);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!shown) return null;
  return (
    <div key={shown.id} className="ai-done" role="status" aria-live="polite">
      <span className="ai-done-check" aria-hidden>
        <svg viewBox="0 0 16 16" width="10" height="10">
          <path d="M3.5 8.4 6.6 11.4 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {shown.label}
    </div>
  );
}
