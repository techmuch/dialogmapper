/**
 * Generates the CLI reference from the binary's own help output.
 *
 * Hand-written command reference is wrong within about two releases: a flag
 * gets renamed, nobody remembers the website exists, and the docs quietly start
 * lying. Asking the binary what it supports means the page can only ever be as
 * wrong as the tool is.
 *
 *   node website/scripts/reference.mjs
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "generated");
const BIN = process.env.DIALOGMAPPER_BIN ?? join(HERE, "..", "..", "dialogmapper");

const run = (...args) => execFileSync(BIN, args, { encoding: "utf8" });

/** Pulls "  name   summary" pairs out of a cobra help screen. */
function parseCommands(help) {
  const section = help.split(/Available Commands:\n/)[1];
  if (!section) return [];
  return section
    .split(/\n\s*\n/)[0]
    .split("\n")
    .map((line) => /^\s{2,}(\S+)\s{2,}(.+)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({ name: m[1], summary: m[2].trim() }));
}

/** Pulls flag rows out of the "Flags:" block. */
function parseFlags(help) {
  const section = help.split(/\nFlags:\n/)[1];
  if (!section) return [];
  return section
    .split(/\n\s*\n/)[0]
    .split("\n")
    .map((line) => /^\s{2,}(-\S,\s)?(--[\w-]+)(\s+\S+)?\s{2,}(.+)$/.exec(line))
    .filter(Boolean)
    .map((m) => ({
      flag: m[2],
      arg: (m[3] ?? "").trim(),
      summary: m[4].trim(),
    }))
    .filter((f) => f.flag !== "--help");
}

const root = run("--help");
const commands = parseCommands(root).map((c) => {
  const help = run(c.name, "--help");
  const subs = parseCommands(help);
  return {
    ...c,
    // The first paragraph of the long description, which is where cobra puts
    // the sentence actually worth reading.
    blurb: help.split(/\n\s*\n/)[0].trim(),
    flags: parseFlags(help),
    subcommands: subs.map((s) => {
      const subHelp = run(c.name, s.name, "--help");
      return { ...s, flags: parseFlags(subHelp) };
    }),
  };
});

const version = run("--version").trim();

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "cli.json"),
  `${JSON.stringify({ version, commands }, null, 2)}\n`,
);
console.log(
  `wrote ${commands.length} commands (${commands.reduce(
    (n, c) => n + c.subcommands.length,
    0,
  )} subcommands) from ${version}`,
);
