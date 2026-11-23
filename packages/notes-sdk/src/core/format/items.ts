import { invalidDocument } from "../errors/notes-error.js";
import type {
  NotesAudioAnchor,
  NotesImage,
  NotesItem,
  NotesLink,
  NotesStroke,
  NotesText,
} from "../model/items.js";
import {
  NOTES_LENGTH_RANGE,
  NOTES_MAX_STROKE_POINTS,
  NOTES_MAX_TEXT_LENGTH,
  NOTES_POSITION_RANGE,
  NOTES_PRESSURE_MAX,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
} from "../model/portable.js";
import { assetReference, color, fields, id, integer, list, MAX_TIME, oneOf, text } from "./read.js";

/** The media types a picture may have. SVG is never one: it can carry scripts. */
export const NOTES_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** The media type of a page's PDF. */
export const NOTES_PDF_TYPE = "application/pdf";

/**
 * The media types a recording may have: what browsers' recorders write.
 * Parameters, such as a codec, aren't kept.
 */
export const NOTES_AUDIO_TYPES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"] as const;

const position = (value: unknown, at: string): number =>
  integer(value, at, ...NOTES_POSITION_RANGE, "invalid-position");

const length = (value: unknown, at: string): number =>
  integer(value, at, ...NOTES_LENGTH_RANGE, "invalid-size");

function audioAnchor(value: unknown, at: string): NotesAudioAnchor {
  const entry = fields(value, at, ["recording", "at"]);
  return {
    recording: id(entry["recording"], `${at}.recording`),
    at: integer(entry["at"], `${at}.at`, 0, MAX_TIME, "invalid-time"),
  };
}

function stroke(value: unknown, at: string): NotesStroke {
  const entry = fields(
    value,
    at,
    ["id", "type", "tool", "color", "size", "points"],
    ["uniform", "audio"],
  );
  const raw = entry["points"];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length % 3 !== 0) {
    throw invalidDocument("invalid-points", `${at}.points`);
  }
  if (raw.length > NOTES_MAX_STROKE_POINTS * 3) {
    throw invalidDocument("too-many-points", `${at}.points`);
  }
  const points = new Array<number>(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    const where = `${at}.points[${index}]`;
    points[index] =
      index % 3 === 2
        ? integer(raw[index], where, 0, NOTES_PRESSURE_MAX, "invalid-points")
        : integer(raw[index], where, ...NOTES_POSITION_RANGE, "invalid-points");
  }
  if (Object.hasOwn(entry, "uniform") && entry["uniform"] !== true) {
    throw invalidDocument("malformed-document", `${at}.uniform`);
  }
  return {
    id: id(entry["id"], `${at}.id`),
    type: "stroke",
    tool: oneOf(entry["tool"], `${at}.tool`, ["pen", "highlighter"]),
    color: color(entry["color"], `${at}.color`),
    size: integer(entry["size"], `${at}.size`, ...NOTES_STROKE_SIZE_RANGE, "invalid-size"),
    points,
    ...(entry["uniform"] === true ? { uniform: true as const } : {}),
    ...(Object.hasOwn(entry, "audio") ? { audio: audioAnchor(entry["audio"], `${at}.audio`) } : {}),
  };
}

function textBox(value: unknown, at: string): NotesText {
  const entry = fields(
    value,
    at,
    ["id", "type", "x", "y", "width", "text", "size", "color"],
    ["audio"],
  );
  return {
    id: id(entry["id"], `${at}.id`),
    type: "text",
    x: position(entry["x"], `${at}.x`),
    y: position(entry["y"], `${at}.y`),
    width: length(entry["width"], `${at}.width`),
    text: text(entry["text"], `${at}.text`, NOTES_MAX_TEXT_LENGTH, "text-too-long"),
    size: integer(entry["size"], `${at}.size`, ...NOTES_TEXT_SIZE_RANGE, "invalid-size"),
    color: color(entry["color"], `${at}.color`),
    ...(Object.hasOwn(entry, "audio") ? { audio: audioAnchor(entry["audio"], `${at}.audio`) } : {}),
  };
}

function image(value: unknown, at: string): NotesImage {
  const entry = fields(value, at, ["id", "type", "x", "y", "width", "height", "image"]);
  return {
    id: id(entry["id"], `${at}.id`),
    type: "image",
    x: position(entry["x"], `${at}.x`),
    y: position(entry["y"], `${at}.y`),
    width: length(entry["width"], `${at}.width`),
    height: length(entry["height"], `${at}.height`),
    image: assetReference(entry["image"], `${at}.image`, NOTES_IMAGE_TYPES),
  };
}

function link(value: unknown, at: string): NotesLink {
  const entry = fields(value, at, ["id", "type", "x", "y", "width", "height", "page"]);
  return {
    id: id(entry["id"], `${at}.id`),
    type: "link",
    x: position(entry["x"], `${at}.x`),
    y: position(entry["y"], `${at}.y`),
    width: length(entry["width"], `${at}.width`),
    height: length(entry["height"], `${at}.height`),
    page: id(entry["page"], `${at}.page`),
  };
}

/** Reads one item from untrusted JSON, strictly. */
export function readItem(value: unknown, at: string): NotesItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidDocument("malformed-document", at);
  }
  const type = Object.hasOwn(value, "type") ? (value as { type: unknown }).type : undefined;
  switch (type) {
    case "stroke":
      return stroke(value, at);
    case "text":
      return textBox(value, at);
    case "image":
      return image(value, at);
    case "link":
      return link(value, at);
    default:
      throw invalidDocument("malformed-document", `${at}.type`);
  }
}

/** Reads a page's items, refusing two with one id. */
export function readItems(value: unknown, at: string, maximum: number): NotesItem[] {
  const seen = new Set<string>();
  return list(value, at, maximum).map((entry, index) => {
    const item = readItem(entry, `${at}[${index}]`);
    if (seen.has(item.id)) throw invalidDocument("duplicate-id", `${at}[${index}].id`);
    seen.add(item.id);
    return item;
  });
}
