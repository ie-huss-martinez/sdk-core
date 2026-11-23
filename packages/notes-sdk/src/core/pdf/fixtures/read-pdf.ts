import { inflateSync } from "node:zlib";

/**
 * A reader of the files this package's own PDF writer makes, for its tests.
 * It isn't a PDF parser: it relies on how the writer lays a file out, and
 * throws on anything else, which fails the test that called it.
 */

/** One indirect object of a file. */
export interface ReadPdfObject {
  readonly id: number;
  /** The object's value in PDF syntax: for a stream, its dictionary. */
  readonly text: string;
  /** A stream's data as the file holds it. */
  readonly raw?: Uint8Array;
  /** A stream's data, inflated when its filter is `FlateDecode`. */
  readonly data?: Uint8Array;
}

/** A file's objects and trailer. */
export interface ReadPdf {
  /** The whole file, one character per byte. */
  readonly text: string;
  readonly objects: ReadonlyMap<number, ReadPdfObject>;
  /** The trailer dictionary, in PDF syntax. */
  readonly trailer: string;
}

/** One operator of a content stream, with the operands written before it. */
export interface ContentOperator {
  readonly operator: string;
  /** The operands as written, such as `10 20` or `(Hello)`. */
  readonly operands: string;
  /** The operands that are numbers. */
  readonly numbers: readonly number[];
}

function fail(message: string): never {
  throw new Error(`Not a file of this writer: ${message}`);
}

/**
 * Reads a file through its cross-reference table, checking on the way that
 * `startxref` points at the table, that every entry is 20 bytes and points
 * at its object, and that every stream is as long as its `Length` says.
 */
export function readPdf(bytes: Uint8Array): ReadPdf {
  const text = Buffer.from(bytes).toString("latin1");
  const end = /startxref\n(\d+)\n%%EOF\n$/.exec(text);
  if (!end) fail("no startxref at the end");
  const tableAt = Number(end[1]);
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(tableAt, tableAt + 40));
  if (!head) fail("startxref doesn't point at a cross-reference table");
  const size = Number(head[1]);
  const entriesAt = tableAt + head[0].length;
  const objects = new Map<number, ReadPdfObject>();
  for (let id = 0; id < size; id += 1) {
    const entry = text.slice(entriesAt + id * 20, entriesAt + (id + 1) * 20);
    if (id === 0) {
      if (entry !== "0000000000 65535 f \n") fail("the first entry isn't the free list's head");
      continue;
    }
    const match = /^(\d{10}) 00000 n \n$/.exec(entry);
    if (!match) fail(`entry ${id} is malformed`);
    objects.set(id, readObject(bytes, text, id, Number(match[1])));
  }
  const trailerAt = entriesAt + size * 20;
  const trailer = /^trailer\n(<<.*>>)\nstartxref\n/.exec(text.slice(trailerAt));
  if (!trailer?.[1]) fail("no trailer after the table");
  return { text, objects, trailer: trailer[1] };
}

function readObject(bytes: Uint8Array, text: string, id: number, offset: number): ReadPdfObject {
  const start = `${id} 0 obj\n`;
  if (!text.startsWith(start, offset)) fail(`entry ${id} doesn't point at its object`);
  const bodyAt = offset + start.length;
  const streamAt = text.indexOf("\nstream\n", bodyAt);
  const endAt = text.indexOf("\nendobj\n", bodyAt);
  if (endAt < 0) fail(`object ${id} has no end`);
  // A stream's data may hold "endobj" itself, so a dictionary that opens the
  // object and is followed by "stream" decides, and its Length is trusted.
  const dictionary = streamAt < 0 ? "" : text.slice(bodyAt, streamAt);
  const length = /\/Length (\d+)/.exec(dictionary);
  if (!length || !dictionary.startsWith("<<") || dictionary.includes("\n")) {
    return { id, text: text.slice(bodyAt, endAt) };
  }
  const dataAt = streamAt + "\nstream\n".length;
  const dataEnd = dataAt + Number(length[1]);
  if (!text.startsWith("\nendstream\nendobj\n", dataEnd)) fail(`stream ${id} has a wrong Length`);
  const raw = bytes.slice(dataAt, dataEnd);
  const data = dictionary.includes("/Filter /FlateDecode") ? new Uint8Array(inflateSync(raw)) : raw;
  return { id, text: dictionary, raw, data };
}

/** The object a reference in `text` names after `key`, such as `/Root 1 0 R`. */
export function referenced(pdf: ReadPdf, text: string, key: string): ReadPdfObject {
  const match = new RegExp(`/${key} (\\d+) 0 R`).exec(text);
  const object = match ? pdf.objects.get(Number(match[1])) : undefined;
  return object ?? fail(`no object for /${key}`);
}

/** The file's pages, in order, through its catalog and page tree. */
export function pagesOf(pdf: ReadPdf): ReadPdfObject[] {
  const tree = referenced(pdf, referenced(pdf, pdf.trailer, "Root").text, "Pages");
  const kids = /\/Kids \[([^\]]*)\]/.exec(tree.text);
  if (!kids) fail("the page tree has no Kids");
  return [...(kids[1] ?? "").matchAll(/(\d+) 0 R/g)].map(
    (kid) => pdf.objects.get(Number(kid[1])) ?? fail("a page is missing"),
  );
}

/** A page's content stream, as text. */
export function contentOf(pdf: ReadPdf, page: ReadPdfObject): string {
  const stream = referenced(pdf, page.text, "Contents");
  return Buffer.from(stream.data ?? fail("the page's contents aren't a stream")).toString("latin1");
}

/** The operators of a content stream this writer made: one per line. */
export function operatorsOf(content: string): ContentOperator[] {
  return content
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const space = line.lastIndexOf(" ");
      const operands = space < 0 ? "" : line.slice(0, space);
      const numbers = operands
        .split(" ")
        .filter((operand) => /^-?\d+(\.\d+)?$/.test(operand))
        .map(Number);
      return { operator: line.slice(space + 1), operands, numbers };
    });
}

/** The bytes of a literal string, `(...)`, with its escapes undone. */
export function literalBytes(literal: string): number[] {
  if (!literal.startsWith("(") || !literal.endsWith(")")) fail("not a literal string");
  const bytes: number[] = [];
  for (let index = 1; index < literal.length - 1; index += 1) {
    if (literal[index] !== "\\") {
      bytes.push(literal.charCodeAt(index));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(literal.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
    } else {
      bytes.push(literal.charCodeAt(index + 1));
      index += 1;
    }
  }
  return bytes;
}
