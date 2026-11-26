// Stub for the pele diagram renderer (obsidianmd/pele, browser build).
//
// Pond's repo leaves its vendor/ folders out (README: "vendor/ folders and jsconfig.json are
// left out"), so this copy has no pele. Diagrams in a conversation degrade: the chat calls
// render() per diagram, gets an error, and draws the diagram's source as a code block instead.
// To draw them, replace this folder with pele's browser build (core.js + diagrams/*.js).

export function register(..._diagrams) {}

export function render(_source, _options) {
  throw new Error("pele isn't installed in this copy");
}
