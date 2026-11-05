import { toast, useStore } from "./store";
import { socket } from "./socket";
import { copyText } from "./notes";

/**
 * Lets any part of the studio pre-fill the canvas chat (e.g. the welcome screen's style
 * starters) without coupling to the chat dock's internal state.
 */
type DraftHandler = (text: string, select?: [number, number]) => void;

let handler: DraftHandler | null = null;

/** The chat dock registers itself here. Returns an unsubscribe function. */
export function onChatDraft(fn: DraftHandler): () => void {
  handler = fn;
  return () => {
    if (handler === fn) handler = null;
  };
}

/**
 * Put `text` in the chat box and focus it; `select` highlights a range (e.g. a placeholder
 * the user should overwrite). Returns false when the chat is not mounted.
 */
export function setChatDraft(text: string, select?: [number, number]): boolean {
  if (!handler) return false;
  handler(text, select);
  return true;
}

/**
 * Send a ready-made request to the canvas chat (one-click actions, guided start). When your AI
 * is still busy the text waits in the chat box instead; without a chat it is copied.
 * Returns how it was delivered.
 */
export async function sendChatRequest(text: string, o: { frame?: string | null; variants?: number } = {}): Promise<"sent" | "drafted" | "copied" | "none"> {
  const s = useStore.getState();
  if (!s.doc) return "none";
  if (!s.chat) {
    await copyText(text);
    toast("Request copied — paste it in your AI");
    return "copied";
  }
  if (s.chat.busy) {
    setChatDraft(text);
    toast("Your AI is still working — the request is waiting in the chat box");
    return "drafted";
  }
  socket.send({ t: "chat", text, frame: o.frame ?? s.activeFrame, selection: [], variants: o.variants && o.variants > 1 ? o.variants : undefined });
  toast("Sent to your AI", "agent");
  return "sent";
}
