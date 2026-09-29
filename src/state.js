// The open design: its pages, size and file path, plus a small event bus the
// panels listen to.

export const SIZE_PRESETS = [
  { id: 'ig-portrait', name: 'Instagram post 4:5', width: 1080, height: 1350, dpi: 72 },
  { id: 'ig-square', name: 'Instagram post 1:1', width: 1080, height: 1080, dpi: 72 },
  { id: 'story', name: 'Story 9:16', width: 1080, height: 1920, dpi: 72 },
  { id: 'fb-cover', name: 'Facebook cover', width: 1640, height: 624, dpi: 72 },
  { id: 'a4', name: 'A4 flyer, 300 dpi', width: 2480, height: 3508, dpi: 300 },
];

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const listeners = new Map();
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name).delete(fn);
}
export function emit(name, data) {
  listeners.get(name)?.forEach((fn) => {
    try {
      fn(data);
    } catch (e) {
      console.error(name, e);
    }
  });
}

export const state = {
  doc: null,
  pageIndex: 0,
  path: null, // where the design was last saved (desktop only)
  dirty: false,
  brandKitId: null,
};

export function newDoc({ name = 'Untitled design', width, height, dpi = 72 }) {
  return {
    id: uid(),
    name,
    width,
    height,
    dpi,
    pages: [newPage()],
  };
}

export function newPage(background = '#ffffff') {
  return { id: uid(), background, objects: [], thumb: null };
}

export const currentPage = () => state.doc.pages[state.pageIndex];

export function markDirty() {
  state.dirty = true;
  emit('dirty');
}
