// Keys for the Workbench panel: one table drives the footer, the ? card and the handler.

export function keyOf(e) {
  const m = e.modifiers ?? {};
  if (e.key === "tab" && m.shift && !m.control && !m.platform && !m.alt) return "shift-tab";
  if (m.control || m.platform || m.alt) return e.keystroke;
  if (["enter", "escape", "tab", "space", "up", "down", "left", "right", "backspace"].includes(e.key)) return e.key;
  return e.key_char ?? e.key;
}

const TABS = { caps: ["]", "["], label: "tabs" };
export const KEYS = {
  everywhere: [
    { caps: ["]", "["], label: "next / prev tab" },
    { caps: ["1", "4"], label: "Search / Files / Format / Dupes" },
    { caps: ["tab"], label: "next tab" },
    { caps: ["/"], label: "search" },
    { caps: ["e"], label: "into file" },
    { caps: ["E"], label: "expand / collapse" },
    { caps: ["escape"], label: "back to terminal" },
    { caps: ["q"], label: "close panel" },
    { caps: ["?"], label: "all keys" },
  ],
  search: [
    { caps: ["j", "k"], label: "move" },
    { caps: ["enter"], label: "open" },
    { caps: ["space"], label: "peek" },
    TABS,
    { caps: ["/"], label: "search" },
    { caps: ["h", "l"], label: "fold" },
    { caps: ["r"], label: "replace" },
    { caps: ["x"], label: "include" },
    { caps: ["R"], label: "replace all" },
    { caps: ["u"], label: "undo replace" },
    { caps: ["c"], label: "match case" },
    { caps: ["w"], label: "whole word" },
    { caps: ["."], label: "regex" },
    { caps: ["f"], label: "file filter" },
    { caps: ["z"], label: "fold all" },
    { caps: ["g", "G"], label: "top / bottom" },
    { caps: ["ctrl-d", "ctrl-u"], label: "half page" },
  ],
  goto: [
    { caps: ["j", "k"], label: "move" },
    { caps: ["enter"], label: "open" },
    { caps: ["space"], label: "peek" },
    TABS,
    { caps: ["/"], label: "filter" },
    { caps: ["g", "G"], label: "top / bottom" },
  ],
  format: [
    { caps: ["f"], label: "format" },
    { caps: ["s"], label: "what" },
    TABS,
    { caps: ["}", "{"], label: "rules source" },
    { caps: ["x"], label: "lint fixes" },
    { caps: ["o"], label: "on save" },
    { caps: ["b"], label: "built-ins" },
    { caps: ["p"], label: "run script" },
    { caps: ["u"], label: "undo" },
    { caps: ["R"], label: "re-read setup" },
  ],
  dedupe: [
    { caps: ["d"], label: "delete" },
    { caps: ["j", "k"], label: "move" },
    { caps: ["space"], label: "peek" },
    TABS,
    { caps: ["t"], label: "trim" },
    { caps: ["b"], label: "keep blank" },
    { caps: ["a"], label: "consecutive" },
    { caps: ["W"], label: "whole file" },
  ],
  // Tab switching shows in every tool's footer, after its own first keys.
  typing: [{ caps: ["enter"], label: "results" }, { caps: ["down"], label: "results" }, { caps: ["escape"], label: "stop typing" }],
  typingGoto: [{ caps: ["up", "down"], label: "move" }, { caps: ["enter"], label: "open" }, { caps: ["escape"], label: "stop typing" }],
  editor: [{ caps: ["escape"], label: "back to list" }, { caps: ["cmd-s"], label: "save" }],
  menu: [{ caps: ["y"], label: "confirm" }, { caps: ["n"], label: "cancel" }],
};
