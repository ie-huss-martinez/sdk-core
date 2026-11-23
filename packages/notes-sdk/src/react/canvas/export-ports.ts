import type { NotesImage, NotesText } from "../../core/model/items.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type {
  NotesExportImage,
  NotesPdfExportPorts,
  NotesTextLayout,
} from "../../core/pdf/export.js";
import type { ImageCache } from "./image-cache.js";
import { layoutText, NOTES_TEXT_FONT } from "./text-layout.js";

/** The longest side of a picture in an exported PDF, in pixels. Larger ones are scaled down. */
const MAX_IMAGE_SIDE = 2400;
/** How many pixels a rasterised text box has per PDF point: 300 dots per inch. */
const TEXT_DENSITY = 300 / 72;

function scratch(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : undefined;
}

/** A text box as a picture, for text the PDF's own font can't write. */
function rasterizeText(item: NotesText, layout: NotesTextLayout): NotesExportImage | undefined {
  const scale = TEXT_DENSITY / NOTES_UNITS_PER_POINT;
  const surface = scratch(item.width * scale, layout.lines.length * layout.lineHeight * scale);
  if (!surface) return undefined;
  const { canvas, context } = surface;
  context.scale(scale, scale);
  context.fillStyle = item.color;
  context.font = `${item.size}px ${NOTES_TEXT_FONT}`;
  context.textBaseline = "alphabetic";
  layout.lines.forEach((line, index) => {
    context.fillText(line.text, 0, layout.ascent + index * layout.lineHeight);
  });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  return { kind: "rgba", width: canvas.width, height: canvas.height, data: pixels.data };
}

/**
 * What the PDF exporter needs from the page (docs/adr/0006): how text boxes
 * break into lines on screen, pictures of text its font can't write, and
 * the pixels of placed images, decoded by the browser.
 */
export function createExportPorts(images: ImageCache): NotesPdfExportPorts {
  return {
    layoutText,
    rasterizeText: async (item, layout) => rasterizeText(item, layout),
    async loadImage(item: NotesImage) {
      const bitmap = await images.load(item.image);
      if (!bitmap) return undefined;
      const fit = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const surface = scratch(bitmap.width * fit, bitmap.height * fit);
      if (!surface) return undefined;
      const { canvas, context } = surface;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (item.image.mediaType === "image/jpeg") {
        // A photograph stays a JPEG: drawn once, so its orientation is applied, and encoded again.
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.9),
        );
        if (blob) {
          return {
            kind: "jpeg",
            width: canvas.width,
            height: canvas.height,
            bytes: new Uint8Array(await blob.arrayBuffer()),
          };
        }
      }
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      return { kind: "rgba", width: canvas.width, height: canvas.height, data: pixels.data };
    },
  };
}
