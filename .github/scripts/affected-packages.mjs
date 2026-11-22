#!/usr/bin/env node
// Lists the packages a pull request can affect, for the verify workflow's
// matrix (ADR 0064).
//
// Usage: node affected-packages.mjs [--all | <base> <head>]
//
// A package is affected when a file under its folder changed, or when a
// package it depends on is affected: a dependency, a devDependency or a
// peerDependency on a workspace package. A change outside packages/ that
// isn't documentation affects every package, because the workspace's
// lockfile, catalog, lint configuration and workflows reach them all. When
// in doubt it runs more, never less.
//
// It prints a JSON array of folder names under packages/, and writes it to
// $GITHUB_OUTPUT as `packages`, with `any` beside it.

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** Folder names go into a job's name and a pnpm filter, so they're plain. */
const FOLDER = /^[a-z0-9][a-z0-9-]*$/;

/** Outside packages/, these can't change what a package builds or tests. */
const DOCUMENTATION = [
  /^docs\//,
  /^[^/]+\.md$/,
  /^LICENSE$/,
  /^\.changeset\/[^/]+\.md$/,
  /^\.github\/ISSUE_TEMPLATE\//,
  /^\.github\/pull_request_template\.md$/,
];

/** Inside a package, its decision records. A README is published, so it counts. */
const PACKAGE_DOCUMENTATION = /^packages\/[^/]+\/docs\//;

/**
 * The workspace's top-level packages and the workspace packages each depends on.
 *
 * @param {string} root
 * @returns {Map<string, { name: string, uses: string[] }>} by folder name
 */
export function readPackages(root) {
  const packages = new Map();
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    const file = join(root, "packages", entry.name, "package.json");
    if (!entry.isDirectory() || !existsSync(file)) {
      continue;
    }
    if (!FOLDER.test(entry.name)) {
      throw new Error(`packages/${entry.name}: a package's folder name must match ${FOLDER}.`);
    }
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const uses = ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(([, range]) => String(range).startsWith("workspace:"))
        .map(([name]) => name),
    );
    packages.set(entry.name, { name: manifest.name, uses });
  }
  return packages;
}

/**
 * @param {string[]} files Changed files, relative to the root, with forward slashes.
 * @param {Map<string, { name: string, uses: string[] }>} packages
 * @returns {string[]} The affected packages' folder names, sorted.
 */
export function affectedPackages(files, packages) {
  const all = [...packages.keys()].sort();
  const affected = new Set();
  for (const file of files) {
    const [top, folder] = file.split("/");
    if (top !== "packages") {
      if (!DOCUMENTATION.some((pattern) => pattern.test(file))) {
        return all;
      }
    } else if (!packages.has(folder)) {
      // A file beside the packages, or a package that was removed.
      return all;
    } else if (!PACKAGE_DOCUMENTATION.test(file)) {
      affected.add(folder);
    }
  }
  const folderOf = new Map([...packages].map(([folder, { name }]) => [name, folder]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [folder, { uses }] of packages) {
      if (!affected.has(folder) && uses.some((name) => affected.has(folderOf.get(name)))) {
        affected.add(folder);
        grew = true;
      }
    }
  }
  return all.filter((folder) => affected.has(folder));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const packages = readPackages(root);
  const args = process.argv.slice(2);
  let result;
  if (args.length === 1 && args[0] === "--all") {
    result = [...packages.keys()].sort();
  } else if (args.length === 2) {
    const files = execFileSync("git", ["diff", "--name-only", "--no-renames", args[0], args[1]], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    result = affectedPackages(files, packages);
  } else {
    process.stderr.write("Usage: node affected-packages.mjs [--all | <base> <head>]\n");
    process.exit(2);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `packages=${JSON.stringify(result)}\nany=${result.length > 0}\n`,
    );
  }
}
