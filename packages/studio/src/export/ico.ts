/**
 * Multi-size Windows .ico with PNG-compressed entries (supported by every browser
 * and by Windows Vista+). Layout: ICONDIR (6 bytes) + n × ICONDIRENTRY (16 bytes) + PNG data.
 */
export interface IcoImage {
  /** Square size in px (1–256). */
  size: number;
  png: Uint8Array;
}

export function buildIco(images: IcoImage[]): Blob {
  const list = [...images].sort((a, b) => a.size - b.size);
  const headerSize = 6 + 16 * list.length;
  const total = headerSize + list.reduce((s, i) => s + i.png.byteLength, 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: 1 = icon
  v.setUint16(4, list.length, true);
  let offset = headerSize;
  list.forEach((img, i) => {
    if (img.size < 1 || img.size > 256) throw new Error(`ICO entries must be 1–256 px (got ${img.size})`);
    const e = 6 + i * 16;
    v.setUint8(e, img.size >= 256 ? 0 : img.size); // width (0 = 256)
    v.setUint8(e + 1, img.size >= 256 ? 0 : img.size); // height
    v.setUint8(e + 2, 0); // palette colors
    v.setUint8(e + 3, 0); // reserved
    v.setUint16(e + 4, 1, true); // color planes
    v.setUint16(e + 6, 32, true); // bits per pixel
    v.setUint32(e + 8, img.png.byteLength, true);
    v.setUint32(e + 12, offset, true);
    buf.set(img.png, offset);
    offset += img.png.byteLength;
  });
  return new Blob([buf], { type: "image/x-icon" });
}

/** Parse an .ico header back (used by tests/harness to verify output). */
export function readIcoHeader(bytes: Uint8Array): { count: number; entries: { width: number; height: number; bpp: number; size: number; offset: number; png: boolean }[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) throw new Error("Not an ICO file");
  const count = v.getUint16(4, true);
  const entries = Array.from({ length: count }, (_, i) => {
    const e = 6 + i * 16;
    const offset = v.getUint32(e + 12, true);
    return {
      width: v.getUint8(e) || 256,
      height: v.getUint8(e + 1) || 256,
      bpp: v.getUint16(e + 6, true),
      size: v.getUint32(e + 8, true),
      offset,
      png: bytes[offset] === 0x89 && bytes[offset + 1] === 0x50 && bytes[offset + 2] === 0x4e && bytes[offset + 3] === 0x47,
    };
  });
  return { count, entries };
}
