/**
 * Mockups: the logo shown on real applications. The scenes are drawn in the studio
 * (flat ones as SVG compositions, 3D ones with the 3D engine); this list is shared with
 * the MCP server so the agent can ask for any of them.
 */

export type MockupKind =
  | "business-card"
  | "app-icon"
  | "browser-tab"
  | "storefront"
  | "tote"
  | "avatar"
  | "letterhead"
  | "foil-card"
  | "wall-sign";

export interface MockupInfo {
  id: MockupKind;
  label: string;
  description: string;
  engine: "2d" | "3d";
}

export const MOCKUPS: MockupInfo[] = [
  { id: "business-card", label: "Business cards", description: "Front and back on a desk, with soft daylight shadows", engine: "2d" },
  { id: "app-icon", label: "App icon", description: "Squircle icon on a phone home screen, plus a large detail", engine: "2d" },
  { id: "browser-tab", label: "Browser tab", description: "Favicon in a tab and the address bar, with 16/32 px pixel checks", engine: "2d" },
  { id: "avatar", label: "Social avatar", description: "Circular profile picture on a profile card and at small sizes", engine: "2d" },
  { id: "storefront", label: "Storefront", description: "Fascia sign and hanging blade sign on a shop front", engine: "2d" },
  { id: "tote", label: "Tote bag", description: "Screen print on a canvas tote", engine: "2d" },
  { id: "letterhead", label: "Letterhead", description: "Letter sheet and envelope", engine: "2d" },
  { id: "foil-card", label: "Foil-stamped card", description: "3D: the logo foil-stamped on a thick card", engine: "3d" },
  { id: "wall-sign", label: "Wall sign", description: "3D: dimensional letters standing off a wall", engine: "3d" },
];

export const MOCKUP_KINDS = MOCKUPS.map((m) => m.id) as [MockupKind, ...MockupKind[]];

export type MockupTheme = "auto" | "light" | "dark";

export interface MockupParams {
  kind: MockupKind;
  /** Frame (version); defaults to the active one. */
  frame?: string;
  /** Output width in px (scenes are 4:3). Default 1600. */
  width?: number;
  /** Light or dark surroundings; "auto" picks what makes the logo read best. */
  theme?: MockupTheme;
}

export interface MockupResponse {
  /** Base64 PNG (no data: prefix). */
  png: string;
  width: number;
  height: number;
  theme: "light" | "dark";
}
