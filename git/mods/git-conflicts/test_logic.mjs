// Self-check: node mods/git-conflicts/test_logic.mjs
import assert from "node:assert/strict";
import { conflictsOf, parse, resolve, rows, unmerged } from "./logic.mjs";

const file = ["a", "<<<<<<< HEAD", "ours1", "ours2", "=======", "theirs1", ">>>>>>> main", "b", "<<<<<<< HEAD", "x", "||||||| base", "o", "=======", "y", ">>>>>>> main", ""].join("\n");
const segs = parse(file);
const cs = conflictsOf(segs);
assert.equal(cs.length, 2);
assert.deepEqual(cs[0].ours, ["ours1", "ours2"]);
assert.deepEqual(cs[0].theirs, ["theirs1"]);
assert.equal(cs[0].oursLabel, "HEAD");
assert.equal(cs[0].theirsLabel, "main");
assert.deepEqual(cs[1].base, ["o"]);

assert.equal(resolve(file, 0, "theirs"), ["a", "theirs1", "b", "<<<<<<< HEAD", "x", "||||||| base", "o", "=======", "y", ">>>>>>> main", ""].join("\n"));
assert.equal(resolve(resolve(file, 1, "both"), 0, "ours"), ["a", "ours1", "ours2", "b", "x", "y", ""].join("\n"));

// CRLF and a broken conflict (no end) stays text.
assert.equal(conflictsOf(parse("<<<<<<< HEAD\r\na\r\n=======\r\nb\r\n>>>>>>> x\r\n")).length, 1);
assert.equal(conflictsOf(parse("<<<<<<< HEAD\na\n=======\nb\n")).length, 0);
// "=======" inside ordinary text isn't a conflict.
assert.equal(conflictsOf(parse("=======\ntext\n")).length, 0);

const r = rows(parse(["1", "2", "3", "4", "5", "6", "7", "8", "<<<<<<< HEAD", "o", "=======", "t", ">>>>>>> m", "9"].join("\n")), 3);
assert.deepEqual(r.map((x) => x.kind), ["fold", "ctx", "ctx", "ctx", "head", "ours", "mid", "theirs", "end", "ctx"]);
assert.equal(r[1].line, 6);

assert.deepEqual(unmerged("1 .M N... 100644 100644 100644 a b x.ts\0u UU N... 1 2 3 4 h1 h2 h3 src/my file.ts\0u UD N... 1 2 3 4 h1 h2 h3 y.ts\0"),
  [{ xy: "UU", path: "src/my file.ts" }, { xy: "UD", path: "y.ts" }]);
console.log("ok");
