import { MOCKUPS, type DocT, type MockupKind } from "@brusshy/core";
import type { ExportOptions } from "../export/pipeline";
import { renderMockupPng } from "./render";

/** Export-pipeline glue for the "mockups" format and the brand kit's "In use" page. */

export const MOCKUP_LABEL = "Mockups";
export const DEFAULT_MOCKUP_SIZE = 2400;

/** Scenes used on the brand kit page (the six that read best small). */
export const KIT_MOCKUPS: MockupKind[] = ["business-card", "app-icon", "storefront", "tote", "browser-tab", "foil-card"];

export function mockupDetail(o: ExportOptions): string {
  const n = o.mockups?.kinds?.length ?? MOCKUPS.length;
  return `${n} scenes · ${o.mockups?.size ?? DEFAULT_MOCKUP_SIZE} px PNG`;
}

export interface MockupShot {
  kind: MockupKind;
  label: string;
  png: Blob;
}

/** Render the requested scenes; one failing scene does not stop the rest. */
export async function renderMockupSet(doc: DocT, kinds: MockupKind[], size: number, onProgress?: (p: number) => void): Promise<{ shots: MockupShot[]; failed: string[] }> {
  const shots: MockupShot[] = [];
  const failed: string[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i]!;
    try {
      const r = await renderMockupPng(doc, kind, { width: size });
      shots.push({ kind, label: MOCKUPS.find((m) => m.id === kind)?.label ?? kind, png: r.blob });
    } catch (e) {
      console.error(`[mockups] ${kind} failed`, e);
      failed.push(kind);
    }
    onProgress?.((i + 1) / kinds.length);
  }
  return { shots, failed };
}

/** A compact JPEG copy for the brand kit PDF (full-size PNGs would make it huge). */
export async function forPdf(png: Blob, width = 1400): Promise<Blob> {
  const bmp = await createImageBitmap(png);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = Math.round((bmp.height * width) / bmp.width);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const out = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.9));
  c.width = c.height = 0;
  return out;
}

export async function exportMockups(doc: DocT, o: ExportOptions, base: string, onProgress?: (p: number) => void) {
  const kinds = o.mockups?.kinds?.length ? o.mockups.kinds : MOCKUPS.map((m) => m.id);
  const { shots, failed } = await renderMockupSet(doc, kinds, o.mockups?.size ?? DEFAULT_MOCKUP_SIZE, onProgress);
  if (!shots.length) throw new Error(`No mockup could be drawn (${failed.join(", ")})`);
  return {
    files: shots.map((s) => ({ name: `mockups/${base}-mockup-${s.kind}.png`, blob: s.png })),
    shots,
    note: failed.length ? `Skipped: ${failed.join(", ")}` : undefined,
  };
}
