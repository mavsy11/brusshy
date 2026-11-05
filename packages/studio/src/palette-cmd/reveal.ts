import { toast } from "../lib/store";
import { sectionKey, setSectionCollapsed, showDesignGroupForReveal } from "../panels/designGroups";

/** Side panel tabs (panels/SidePanel.tsx listens for this event). */
export type SideTab = "design" | "layers" | "history" | "code";

export function showSideTab(tab: SideTab) {
  window.dispatchEvent(new CustomEvent<SideTab>("brusshy:side-tab", { detail: tab }));
}

/**
 * Bring a Design-panel section into view and flash it, e.g. revealSection("Warp").
 * Switches the Design tab to the group that holds it (Design / Brand / Motion / Review) and
 * unfolds it first. Finds it by its `data-section` anchor, else by its label's start
 * (case-insensitive), so "Lockup" finds "Lockup · Horizontal".
 */
export function revealSection(title: string, tries = 12) {
  showSideTab("design");
  const key = showDesignGroupForReveal(title);
  const want = title.toLowerCase();
  const look = (left: number) => {
    const all = [...document.querySelectorAll<HTMLElement>(".side-panel .section")];
    const el =
      all.find((s) => s.dataset.section === key) ??
      all.find((s) => (s.querySelector(".section-head .label")?.textContent ?? "").trim().toLowerCase().startsWith(want));
    if (!el) {
      if (left > 0) return requestAnimationFrame(() => look(left - 1));
      return toast(`${title} isn't available for this selection`);
    }
    if (el.dataset.collapsed === "true") {
      // Found under another key (label match): unfold it, then look again once it has rendered.
      setSectionCollapsed(el.dataset.section ?? sectionKey(title), false);
      if (left > 0) return requestAnimationFrame(() => look(left - 1));
    }
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.remove("cmd-flash");
    void el.offsetWidth;
    el.classList.add("cmd-flash");
    setTimeout(() => el.classList.remove("cmd-flash"), 1700);
  };
  requestAnimationFrame(() => look(tries));
}
