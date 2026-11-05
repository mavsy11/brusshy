/// <reference lib="webworker" />
import { PHOTO_STYLES, vectorize, vectorizePhoto, type PhotoVectorizeOptions, type RasterImage, type VectorizeOptions } from "@brusshy/core";

/** Vectorizer worker: keeps the last image and traces it with new options on demand. */
let image: RasterImage | null = null;

type Msg = { id: number; kind?: "image" | "photo" | "thumbs"; options: VectorizeOptions & PhotoVectorizeOptions; image?: RasterImage };

self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, options, kind = "image" } = e.data;
  if (e.data.image) image = e.data.image;
  try {
    if (!image) throw new Error("No image");
    const img = image;
    const result =
      kind === "photo"
        ? vectorizePhoto(img, options)
        : kind === "thumbs"
          ? // Small previews of every style on the same subject (cheap: a 200 px working size).
            PHOTO_STYLES.map((style) => ({ ...vectorizePhoto(img, { ...options, style, workSide: 200 }), mask: { width: 0, height: 0, data: new Uint8Array(0) } }))
          : vectorize(img, options);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
