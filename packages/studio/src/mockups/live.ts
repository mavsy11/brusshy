import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { MOCKUPS, type DocT, type MockupKind, type MockupTheme } from "@brusshy/core";
import { renderMockupPng } from "./render";

/**
 * Live mockup thumbnails: tiles re-render when what they show changes (the active version, its
 * colors, the brand palette, a previewed colorway), debounced, visible tiles first. A newer
 * change cancels the queue of an older one; a render already in flight is discarded. Tiles keep
 * their previous image until the new one is ready, then cross-fade.
 */

export type LiveThumb =
  | { url: string; prev?: string; theme: "light" | "dark"; stale: boolean }
  | { error: string; stale: boolean };

const DEBOUNCE_MS = 400;

/** What a mockup depends on (not timestamps, notes or other versions). */
export function mockupSignature(doc: DocT | null): string {
  if (!doc) return "";
  return JSON.stringify([doc.name, doc.artboard, doc.root, doc.nodes, doc.scene, doc.palette ?? null, doc.typeSystem ?? null]);
}

export function useLiveThumbs(doc: DocT | null, theme: MockupTheme, width: number, scroller: RefObject<HTMLElement | null>) {
  const [thumbs, setThumbs] = useState<Partial<Record<MockupKind, LiveThumb>>>({});
  const key = useMemo(() => mockupSignature(doc), [doc]);
  const docRef = useRef(doc);
  docRef.current = doc;
  const run = useRef({ gen: 0, stale: new Set<MockupKind>(), visible: new Set<MockupKind>(), pumping: false, timer: 0 as ReturnType<typeof setTimeout> | 0, first: true });
  const urls = useRef(new Set<string>());

  const pump = useRef<() => void>(() => undefined);
  pump.current = () => {
    const r = run.current;
    if (r.pumping || r.timer) return;
    r.pumping = true;
    const gen = r.gen;
    void (async () => {
      try {
        for (;;) {
          if (gen !== r.gen) return;
          const kind = MOCKUPS.map((m) => m.id).find((k) => r.stale.has(k) && r.visible.has(k));
          if (!kind) return;
          const d = docRef.current;
          if (!d) return;
          try {
            const out = await renderMockupPng(d, kind, { width, theme });
            if (gen !== r.gen) return; // a newer change arrived while this rendered: drop it
            const url = URL.createObjectURL(out.blob);
            urls.current.add(url);
            r.stale.delete(kind);
            setThumbs((s) => {
              const old = s[kind];
              const prev = old && "url" in old ? old.url : undefined;
              if (prev) setTimeout(() => (URL.revokeObjectURL(prev), urls.current.delete(prev)), 1200);
              return { ...s, [kind]: { url, prev, theme: out.theme, stale: false } };
            });
          } catch (e) {
            if (gen !== r.gen) return;
            console.error(`[mockups] ${kind}`, e);
            r.stale.delete(kind);
            setThumbs((s) => ({ ...s, [kind]: { error: (e as Error).message || "Failed", stale: false } }));
          }
          await new Promise((res) => setTimeout(res, 0));
        }
      } finally {
        r.pumping = false;
        // Something changed or scrolled into view while we worked.
        if (gen !== r.gen || [...r.stale].some((k) => r.visible.has(k))) pump.current();
      }
    })();
  };

  // A change: everything is stale; render after a short pause (immediately on open).
  useEffect(() => {
    const r = run.current;
    if (!doc) return;
    r.gen++;
    r.stale = new Set(MOCKUPS.map((m) => m.id));
    setThumbs((s) => {
      const out: typeof s = {};
      for (const [k, v] of Object.entries(s) as [MockupKind, LiveThumb][]) out[k] = { ...v, stale: true };
      return out;
    });
    if (r.timer) clearTimeout(r.timer);
    r.timer = setTimeout(
      () => {
        r.timer = 0;
        pump.current();
      },
      r.first ? 0 : DEBOUNCE_MS,
    );
    r.first = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme, width]);

  // Which tiles are on screen.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const r = run.current;
        for (const e of entries) {
          const k = (e.target as HTMLElement).dataset.kind as MockupKind | undefined;
          if (!k) continue;
          if (e.isIntersecting) r.visible.add(k);
          else r.visible.delete(k);
        }
        pump.current();
      },
      { root, rootMargin: "120px" },
    );
    root.querySelectorAll<HTMLElement>("[data-kind]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [scroller]);

  // Cancel everything on close.
  useEffect(() => {
    const r = run.current;
    const all = urls.current;
    return () => {
      r.gen++;
      if (r.timer) clearTimeout(r.timer);
      setTimeout(() => all.forEach((u) => URL.revokeObjectURL(u)), 1000);
    };
  }, []);

  return thumbs;
}
