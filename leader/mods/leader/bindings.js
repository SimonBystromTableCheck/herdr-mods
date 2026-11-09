// Leader (ctrl-a) bindings. `run`: an app command (herdr-app commands lists them) with `args`;
// `panel`: show that right-side panel (a `panel-body` child id), `mod` the mod in it when named differently,
// `focus` also gives it the keyboard, `toggle` hides it when it already has the keyboard.
export default [
  { group: "Tabs", key: "t", label: "New tab", run: "tab.new" },
  { group: "Tabs", key: "c", label: "New tab", run: "tab.new", hidden: true },
  { group: "Tabs", key: "n", label: "Next tab", run: "tab.next" },
  { group: "Tabs", key: "p", label: "Previous tab", run: "tab.prev" },
  { group: "Tabs", key: ",", label: "Rename tab", run: "tab.rename" },
  { group: "Tabs", key: "&", label: "Close tab", run: "tab.close" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => ({ group: "Tabs", key: String(i), label: "Go to tab", run: "tab.select", args: { index: i }, hidden: i > 1 })),

  { group: "Panes", key: "%", label: "Split right", run: "pane.split", args: { direction: "right" } },
  { group: "Panes", key: "|", label: "Split right", run: "pane.split", args: { direction: "right" }, hidden: true },
  { group: "Panes", key: "\"", label: "Split down", run: "pane.split", args: { direction: "down" } },
  { group: "Panes", key: "-", label: "Split down", run: "pane.split", args: { direction: "down" }, hidden: true },
  { group: "Panes", key: "h", label: "Go left", run: "pane.go", args: { direction: "left" } },
  { group: "Panes", key: "j", label: "Go down", run: "pane.go", args: { direction: "down" } },
  { group: "Panes", key: "k", label: "Go up", run: "pane.go", args: { direction: "up" } },
  { group: "Panes", key: "l", label: "Go right", run: "pane.go", args: { direction: "right" } },
  { group: "Panes", key: "z", label: "Zoom pane", run: "pane.zoom" },
  { group: "Panes", key: "x", label: "Close pane", run: "pane.close" },

  { group: "Panels", key: "g", label: "Git", panel: "git", focus: true, toggle: true },
  { group: "Panels", key: "a", label: "AI skills", panel: "skills", focus: true, toggle: true },
  { group: "Panels", key: "T", label: "Todos", panel: "todos", focus: true, toggle: true },
  { group: "Panels", key: "e", label: "Expand / collapse", action: "expand" },
  { group: "Panels", key: "f", label: "Files", panel: "files", mod: "my-files", focus: true, toggle: true },
  { group: "Panels", key: "d", label: "Changes (diff)", panel: "changes", mod: "gitview", focus: true, toggle: true },
  { group: "Panels", key: "r", label: "Servers", panel: "servers", focus: true, toggle: true },
  { group: "Panels", key: "b", label: "Toggle sidebar", run: "layout.toggle", args: { id: "sidebar" } },

  { group: "Spaces", key: "s", label: "Find space / tab", run: "mod.open", args: { name: "picker" } },
  { group: "Spaces", key: "o", label: "Find space / tab", run: "mod.open", args: { name: "picker" }, hidden: true },
  { group: "Spaces", key: "$", label: "Rename space", run: "space.rename" },
  { group: "Spaces", key: ")", label: "Next space", run: "space.next" },
  { group: "Spaces", key: "(", label: "Previous space", run: "space.prev" },
  { group: "Spaces", key: "?", label: "All shortcuts", run: "app.help" },
];
