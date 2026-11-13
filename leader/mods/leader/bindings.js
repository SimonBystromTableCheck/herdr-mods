// Leader (ctrl-a) bindings. `run`: an app command (herdr-app commands lists them) with `args`.
//
// Panels aren't listed here: the leader finds them. A panel mod declares its key in its mod.json
// ("panel": {"title", "leader": "T"}), and Herdr's own right-hand panels are bound below by their
// child id in the layout's panel stack (whatever mod shows there: files or pond-files, changes or
// gitview). A panel binding shows it and gives it the keyboard; pressed again from the panel, it hides it.
export const BUILTIN_PANELS = [
  { key: "f", label: "Files", child: "files" },
  { key: "d", label: "Changes (diff)", child: "changes" },
];

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

  { group: "Panels", key: "e", label: "Expand / collapse", action: "expand" },
  { group: "Panels", key: "b", label: "Toggle sidebar", run: "layout.toggle", args: { id: "sidebar" } },

  { group: "Spaces", key: "s", label: "Find space / tab", run: "mod.open", args: { name: "picker" } },
  { group: "Spaces", key: "o", label: "Find space / tab", run: "mod.open", args: { name: "picker" }, hidden: true },
  { group: "Spaces", key: "$", label: "Rename space", run: "space.rename" },
  { group: "Spaces", key: ")", label: "Next space", run: "space.next" },
  { group: "Spaces", key: "(", label: "Previous space", run: "space.prev" },
  { group: "Spaces", key: "?", label: "All shortcuts", run: "app.help" },
];
