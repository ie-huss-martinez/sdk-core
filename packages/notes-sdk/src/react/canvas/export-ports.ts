import type { NotesImage, NotesText } from "../../core/model/items.js";
import type {
  NotesExportImage,
  NotesPdfExportPorts,
  NotesTextLayout,
} from "../../core/pdf/export.js";
import { textRasterSize } from "./canvas-size.js";
import type { ImageCache } from "./image-cache.js";
import { layoutText, NOTES_TEXT_FONT } from "./text-layout.js";

/** The longest side of a picture in an exported PDF, in pixels. Larger ones are scaled down. */
const MAX_IMAGE_SIDE = 2400;

function scratch(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  return context ? { canvas, context } : undefined;
}

/**
 * A text box as a picture, for text the PDF's own font can't write. The
 * picture covers the box's rectangle whatever its size in pixels, so a box
 * too large for 300 dots per inch is drawn with fewer (`textRasterSize`).
 */
function rasterizeText(item: NotesText, layout: NotesTextLayout): NotesExportImage | undefined {
  const height = layout.lines.length * layout.lineHeight;
  const size = textRasterSize(item.width, height);
  const surface = scratch(size.width, size.height);
  if (!surface) return undefined;
  const { canvas, context } = surface;
  // Each axis by its own factor: the whole numbers of pixels differ a little from the box's shape.
  context.scale(canvas.width / Math.max(1, item.width), canvas.height / Math.max(1, height));
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
