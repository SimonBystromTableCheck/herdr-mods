// Stub for ascii-sharks' simulation (Pond's repo leaves vendor/ out). The chat's backdrop is
// off unless a block passes props.backdrop, so nothing here runs in this copy; it exists so the
// scene modules load. With no shark nodes the sharks scene would draw an empty sea, not crash.
// Replace this folder with ascii-sharks to bring the backdrop back.

export const SHARK_NODES = [];

export class World {
  constructor() {
    this.pointer = { x: 0, y: 0 };
  }
  resize() {}
  step() {}
  splash() {}
  stepSharks() {}
}
