import { useEffect, useState } from "react";
import { CHAT_IMAGES, type ChatImage } from "@brusshy/core";
import { token } from "../lib/socket";

/**
 * Images pasted or dropped into the canvas chat. Each one is redrawn on a canvas
 * before upload: that caps its size and drops everything that isn't pixels
 * (EXIF location, embedded data). The daemon checks the bytes again.
 */

/** Largest file we try to read at all (it is downsized before upload). */
const MAX_INPUT = 40 * 1024 * 1024;

export interface PendingImage {
  key: string;
  url: string;
  image?: ChatImage;
  error?: string;
}

export function imageFiles(list: DataTransferItemList | FileList | null | undefined): File[] {
  if (!list) return [];
  const out: File[] = [];
  for (const it of Array.from(list as ArrayLike<DataTransferItem | File>)) {
    const f = it instanceof File ? it : it.kind === "file" ? it.getAsFile() : null;
    if (f && f.type.startsWith("image/")) out.push(f);
  }
  return out;
}

/** Downsize to CHAT_IMAGES.side and re-encode (JPEG stays JPEG, everything else becomes PNG). */
async function reencode(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT) throw new Error("Image is too large");
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, CHAT_IMAGES.side / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const type = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.9));
  if (!blob) throw new Error("Couldn't read the image");
  if (blob.size > CHAT_IMAGES.bytes) throw new Error("Image is too large");
  return blob;
}

export async function uploadImage(file: File): Promise<{ image: ChatImage; url: string }> {
  const blob = await reencode(file);
  const res = await fetch("/api/chat/images", { method: "POST", body: blob, headers: { "content-type": blob.type, "x-brusshy-token": token } });
  const j = (await res.json()) as { image?: ChatImage; error?: string };
  if (!res.ok || !j.image) throw new Error(j.error ?? `HTTP ${res.status}`);
  const url = URL.createObjectURL(blob);
  cache.set(j.image.id, Promise.resolve(url));
  return { image: j.image, url };
}

// Thumbnails of sent images: fetched with the token (an <img src> can't send it), kept as blob URLs.
const cache = new Map<string, Promise<string>>();

function load(id: string): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = fetch(`/api/chat/images/${encodeURIComponent(id)}`, { headers: { "x-brusshy-token": token } }).then(async (r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return URL.createObjectURL(await r.blob());
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function useChatImage(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    load(id).then(
      (u) => live && setUrl(u),
      () => live && setUrl(null),
    );
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}
