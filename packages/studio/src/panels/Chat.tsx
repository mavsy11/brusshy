import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHAT_IMAGES, continueWithVariantOps, findFrame, keepAllVariantsOps, variantsOf, type ChatImage, type ChatMsg, type ChatRunner } from "@brusshy/core";
import { activeFrameId, dispatch, setActiveFrame, useStore } from "../lib/store";
import { socket } from "../lib/socket";
import { copyText } from "../lib/notes";
import { onChatDraft } from "../lib/chatBridge";
import { AiDone } from "./AiDone";
import { imageFiles, uploadImage, useChatImage, type PendingImage } from "./chatImages";
import "../styles/chat.css";

/**
 * The canvas chat: type a request, your own AI (Claude Code, run
 * headless with only Brusshy's tools) draws it live on the canvas.
 */

const SUGGESTIONS = [
  "A minimal fox mark for a coffee roaster, warm palette",
  "Make the selected part bolder and simpler",
  "Turn my sketch into a clean vector logo",
];

const QUEUE_PROMPT = "Check Brusshy's canvas chat (get_chat_requests) and do what I asked there.";

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Re-render every second while something is running (live timers). */
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function readVariants() {
  try {
    return Number(localStorage.getItem("brusshy:chat:variants")) === 4 ? 4 : 1;
  } catch {
    return 1;
  }
}

export function ChatDock() {
  const chat = useStore((s) => s.chat);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const activeFrame = useStore((s) => s.activeFrame);
  const agent = useStore((s) => s.agent);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [variants, setVariantsState] = useState(readVariants);
  const [threadOpen, setThreadOpen] = useState(true);
  const [runnerMenu, setRunnerMenu] = useState(false);
  const [connecting, setConnecting] = useState<ChatRunner | null>(null);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  const busy = !!chat?.busy;
  const running = [...(chat?.messages ?? [])].reverse().find((m) => m.role === "assistant" && (m.status === "running" || m.status === "queued"));
  const externalWork = agent.state === "working" && !busy;
  const now = useNow(busy || externalWork);

  const setVariants = (v: number) => {
    setVariantsState(v);
    try {
      localStorage.setItem("brusshy:chat:variants", String(v));
    } catch {
      /* storage unavailable */
    }
  };

  // Other parts of the studio (welcome screen starters) can pre-fill the chat.
  useEffect(
    () =>
      onChatDraft((text, sel) => {
        setDraft(text);
        requestAnimationFrame(() => {
          const el = input.current;
          if (!el) return;
          el.focus();
          if (sel) el.setSelectionRange(sel[0], sel[1]);
          else el.setSelectionRange(text.length, text.length);
        });
      }),
    [],
  );

  // "/" focuses the chat from anywhere on the canvas.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Grow the textarea with its content (up to a few lines).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  // Keep the newest message in view.
  const last = chat?.messages.at(-1);
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.messages.length, last?.text, last?.steps?.length, threadOpen]);

  if (!doc || !chat) return null;

  const frameId = activeFrame ?? activeFrameId(doc);
  const frame = findFrame(doc, frameId);
  const layers = selection.filter((id) => doc.nodes[id] && doc.nodes[id]!.type !== "frame");
  const runner = chat.runners.find((r) => r.kind === chat.runner);
  const batch = frame?.batch ? variantsOf(doc, frame.batch) : [];

  const uploading = pending.some((p) => !p.image && !p.error);
  const ready = pending.filter((p) => p.image).map((p) => p.image!.id);

  const send = (textIn = draft) => {
    const text = textIn.trim();
    if ((!text && !ready.length) || busy || uploading) return;
    socket.send({ t: "chat", text, frame: frameId, selection: layers, variants: variants > 1 ? variants : undefined, images: ready.length ? ready : undefined });
    setDraft("");
    setPending([]);
    setThreadOpen(true);
  };

  /** Pasted or dropped images: shown right away, uploaded in the background. */
  const addImages = (files: File[]) => {
    const room = CHAT_IMAGES.max - pending.length;
    if (room <= 0 || !files.length) return;
    for (const file of files.slice(0, room)) {
      const key = crypto.randomUUID();
      const preview = URL.createObjectURL(file);
      setPending((list) => [...list, { key, url: preview }]);
      uploadImage(file).then(
        ({ image, url }) => {
          URL.revokeObjectURL(preview);
          setPending((list) => list.map((p) => (p.key === key ? { ...p, image, url } : p)));
        },
        (e: Error) => setPending((list) => list.map((p) => (p.key === key ? { ...p, error: e.message } : p))),
      );
    }
  };

  const closeRunnerMenu = () => {
    setRunnerMenu(false);
    setConnecting(null);
  };
  const pickRunner = (r: ChatRunner, connect = false) => {
    if (r.askConnect && !connect) return setConnecting(r);
    socket.send({ t: "chat-runner", runner: r.kind, connect });
    closeRunnerMenu();
  };

  const showThread = threadOpen && chat.messages.length > 0;
  const showSuggestions = focused && !draft && chat.messages.length === 0;

  return (
    <div className="chat-dock" data-ui onPointerDown={(e) => e.stopPropagation()}>
      <AiDone />
      {batch.length > 1 && frame && (
        <div className="panel chat-variants">
          <span className="cv-label">
            Comparing {batch.length} variants <span className="dim">· {frame.name}</span>
          </span>
          <button
            className="cv-go"
            onClick={() => {
              dispatch(continueWithVariantOps(doc, frame.id), `Continue with ${frame.name}`);
              setActiveFrame(frame.id);
            }}
          >
            Continue with {frame.name}
          </button>
          <button className="cv-keep" onClick={() => dispatch(keepAllVariantsOps(doc, frame.batch!), "Keep all variants")}>
            Keep all
          </button>
        </div>
      )}

      {externalWork && (
        <div className="panel chat-live">
          <LiveHeader label={agent.message || "Your AI is working"} ms={now - (agent.startedAt ?? agent.at)} />
          {(agent.steps?.length ?? 0) > 1 && (
            <ol className="chat-steps">
              {agent.steps!.slice(-5).map((s, i, arr) => (
                <li key={s.at + s.label} className={i === arr.length - 1 ? "now" : "done"}>
                  <StepDot state={i === arr.length - 1 ? "now" : "done"} />
                  <span>{s.label}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {showThread && (
        <div className="panel chat-thread">
          <div className="chat-thread-head">
            <span className="chat-kicker">Chat with your AI</span>
            <span className="grow" />
            {!busy && (
              <button className="chat-link" onClick={() => socket.send({ t: "chat-clear" })} title="Start a new conversation">
                New chat
              </button>
            )}
            <button className="chat-link" onClick={() => setThreadOpen(false)} title="Hide the conversation">
              Hide
            </button>
          </div>
          <div className="chat-msgs" ref={thread}>
            {chat.messages.slice(-40).map((m) => (
              <Message key={m.id} m={m} now={now} frames={doc} />
            ))}
          </div>
        </div>
      )}

      {showSuggestions && (
        <div className="chat-suggest">
          {SUGGESTIONS.map((s) => (
            <button key={s} onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className={`panel chat-bar${focused ? " focused" : ""}${busy ? " busy" : ""}${dragging ? " dragging" : ""}`}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.items).some((i) => i.kind === "file")) return;
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const files = imageFiles(e.dataTransfer.files);
          setDragging(false);
          if (!files.length) return;
          e.preventDefault();
          e.stopPropagation();
          addImages(files);
        }}
      >
        {pending.length > 0 && (
          <div className="chat-attach">
            {pending.map((p) => (
              <div key={p.key} className={`chat-thumb${p.image ? "" : p.error ? " failed" : " loading"}`} title={p.error ?? "Attached image"}>
                <img src={p.url} alt="" />
                <button type="button" aria-label="Remove image" onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))}>
                  ×
                </button>
              </div>
            ))}
            {pending.some((p) => p.error) && <span className="chat-attach-err">{pending.find((p) => p.error)!.error}</span>}
          </div>
        )}
        <textarea
          ref={input}
          rows={1}
          value={draft}
          placeholder={busy ? "Your AI is working — watch the canvas…" : "Ask your AI to design or change something…"}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData.items);
            if (!files.length) return;
            e.preventDefault();
            addImages(files);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") input.current?.blur();
          }}
        />
        <div className="chat-tools">
          <span className="chat-ctx" title="What your AI will work on">
            {frame?.name ?? "—"}
            {layers.length > 0 && <span className="dim"> · {layers.length === 1 ? (doc.nodes[layers[0]!]?.name || "1 layer") : `${layers.length} layers`}</span>}
          </span>
          <div className="chat-seg" role="group" aria-label="How many options">
            <button type="button" className={variants === 1 ? "on" : ""} onClick={() => setVariants(1)} title="One design">
              1
            </button>
            <button type="button" className={variants === 4 ? "on" : ""} onClick={() => setVariants(4)} title="Four variants side by side to compare">
              4
            </button>
          </div>
          <span className="grow" />
          {!threadOpen && chat.messages.length > 0 && (
            <button type="button" className="chat-link" onClick={() => setThreadOpen(true)}>
              Show chat
            </button>
          )}
          <div className="chat-runner">
            <button type="button" className="chat-link" onClick={() => (runnerMenu ? closeRunnerMenu() : setRunnerMenu(true))} title="Which AI runs your requests">
              {runner?.label ?? "AI"} <span className="caret">▾</span>
            </button>
            {runnerMenu && (
              <div className="panel chat-runner-menu" onMouseLeave={closeRunnerMenu}>
                {connecting ? (
                  <div className="chat-connect">
                    <p className="rm-name">Connect {connecting.label} to this chat?</p>
                    <p className="rm-hint">
                      Brusshy would run your {connecting.label} here, on your own plan. It can't be limited as tightly as Claude Code, so the choice is yours. You can also keep chatting in {connecting.label}'s own terminal; the canvas updates either way.
                    </p>
                    <div className="chat-connect-actions">
                      <button type="button" className="chat-link" onClick={closeRunnerMenu}>
                        Keep my terminal
                      </button>
                      <button type="button" className="chat-connect-yes" onClick={() => pickRunner(connecting, true)}>
                        Connect
                      </button>
                    </div>
                  </div>
                ) : (
                  chat.runners.map((r) => (
                    <button type="button" key={r.kind} disabled={!r.available} className={r.kind === chat.runner ? "on" : ""} onClick={() => pickRunner(r)}>
                      <span className="rm-name">{r.label}</span>
                      <span className="rm-hint">{r.kind === "queue" ? "Your AI's own chat picks it up" : r.askConnect ? "Asks before connecting" : r.available ? "Runs here, only Brusshy tools" : r.hint}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {busy ? (
            <button type="button" className="chat-send stop" onClick={() => socket.send({ t: "chat-stop" })} title="Stop">
              <span className="sq" />
            </button>
          ) : (
            <button type="submit" className="chat-send" disabled={(!draft.trim() && !ready.length) || uploading} title="Send (Enter)">
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
        {running?.status === "queued" && (
          <div className="chat-queue">
            Waiting for your AI to pick this up.
            <button type="button" className="chat-link" onClick={() => void copyText(QUEUE_PROMPT)}>
              Copy a prompt for it
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function LiveHeader({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="chat-live-head">
      <span className="live-dot" />
      <span className="live-label">{label}</span>
      <span className="live-time">{fmt(ms)}</span>
    </div>
  );
}

function StepDot({ state }: { state: "now" | "done" | "error" }) {
  if (state === "now") return <span className="step-dot now" />;
  return (
    <svg className={`step-dot ${state}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden>
      {state === "done" ? (
        <path d="M3 6.2 5.1 8.3 9 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 4l4 4M8 4 4 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  );
}

function Message({ m, now, frames }: { m: ChatMsg; now: number; frames: Parameters<typeof findFrame>[0] }) {
  const [stepsOpen, setStepsOpen] = useState(false);
  if (m.role === "user") {
    const f = m.frame ? findFrame(frames, m.frame) : null;
    return (
      <div className="msg user">
        {m.images?.length ? (
          <div className="msg-images">
            {m.images.map((im) => (
              <Thumb key={im.id} image={im} />
            ))}
          </div>
        ) : null}
        {m.text && <div className="bubble">{m.text}</div>}
        <div className="meta">
          {f?.name ?? ""}
          {m.selection?.length ? ` · ${m.selection.length} selected` : ""}
          {m.variants ? ` · ${m.variants} variants` : ""}
        </div>
      </div>
    );
  }
  const live = m.status === "running" || m.status === "queued";
  const steps = m.steps ?? [];
  const showSteps = live || stepsOpen;
  return (
    <div className={`msg ai ${m.status ?? ""}`}>
      {live && <LiveHeader label={m.status === "queued" ? "Waiting for your AI" : (steps.at(-1)?.label ?? "Thinking")} ms={now - m.at} />}
      {m.text && <div className="text">{m.text}</div>}
      {steps.length > 0 && showSteps && (
        <ol className="chat-steps">
          {steps.map((s) => (
            <li key={s.id} className={s.error ? "error" : s.done ? "done" : "now"}>
              <StepDot state={s.error ? "error" : s.done ? "done" : "now"} />
              <span>{s.label}</span>
              <span className="ms">{s.done && s.ms !== undefined ? fmt(s.ms) : fmt(now - s.at)}</span>
            </li>
          ))}
        </ol>
      )}
      {!live && (
        <button className="msg-foot" onClick={() => setStepsOpen((v) => !v)} disabled={!steps.length}>
          {m.status === "error" ? "Failed" : m.status === "stopped" ? "Stopped" : "Done"}
          {m.ms !== undefined ? ` in ${fmt(m.ms)}` : ""}
          {steps.length ? ` · ${steps.length} step${steps.length === 1 ? "" : "s"} ${stepsOpen ? "▴" : "▾"}` : ""}
        </button>
      )}
    </div>
  );
}

function Thumb({ image }: { image: ChatImage }) {
  const url = useChatImage(image.id);
  return <div className="msg-image">{url && <img src={url} alt="" />}</div>;
}
