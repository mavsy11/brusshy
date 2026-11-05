/** Minimal i18n: English now, ready for more locales (add a dictionary and pick it from navigator.language). */

const en: Record<string, string> = {
  "tool.select": "Select",
  "tool.node": "Edit nodes",
  "tool.hand": "Hand",
  "tool.brush": "Sketch brush",
  "tool.rect": "Rectangle",
  "tool.ellipse": "Ellipse",
  "tool.polygon": "Polygon",
  "tool.star": "Star",
  "tool.text": "Text",
  "tool.comment": "Note for your AI",
  "tool.builder": "Shape builder",
  "tool.image": "Add reference image",
  "brush.size": "Size",
  "brush.hint": "Sketch the idea — your AI turns it into clean vector",
  "view.2d": "2D",
  "view.split": "Split",
  "view.3d": "3D",
  "agent.idle": "AI ready",
  "agent.offline": "Reconnecting…",
  "export": "Export",
  "panel.design": "Design",
  "panel.layers": "Layers",
  "empty.title": "Start your logo",
  "empty.body": "Sketch the idea, drop a reference to trace, or just ask your AI.",
};

const dict: Record<string, Record<string, string>> = { en };
const locale = "en";

export function t(key: string): string {
  return dict[locale]?.[key] ?? en[key] ?? key;
}
