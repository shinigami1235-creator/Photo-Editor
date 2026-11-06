// Retouch studio: a big window for one photo with a live preview, a slider
// for every fix, and a choice of which people in the photo to work on. The
// preview runs on a smaller copy so the sliders stay quick; Apply runs the
// same settings on the full photo, where they stay editable.

import { h, rangeField, toast } from './ui.js';
import { loadImage } from './assets.js';
import { detectFaces } from './faces.js';
import { FIXES, PRESETS, NONE, subjectOf, pickPeople } from './beauty.js';
import { quickFix, renderLook, isBusy } from './quickfix.js';
import { saveDefaults } from './defaults.js';

const PREVIEW = 1100;

function smallCopy(img) {
  const w = img.naturalWidth || img.width;
  const hgt = img.naturalHeight || img.height;
  const k = Math.min(1, PREVIEW / Math.max(w, hgt));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k);
  c.height = Math.round(hgt * k);
  const x = c.getContext('2d');
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** A square crop of one face for the People row. */
function faceThumb(src, f, size = 56) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const side = Math.max(f.box.w, f.box.h) * 1.5;
  const cx = f.box.x + f.box.w / 2;
  const cy = f.box.y + f.box.h / 2;
  c.getContext('2d').drawImage(src, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
  return c;
}

export async function openStudio(o) {
  if (isBusy()) return toast('A quick fix is still running.', { error: true });
  const base = o.beautyBase || o.getSrc();
  const img = await loadImage(base);
  const small = smallCopy(img);
  const key = `${base}#studio`;
  const W = small.width;
  const H = small.height;

  const S = { ...NONE, ...(o.beauty || {}), glow: !!o.glowPrev };
  delete S.subjects;
  const faces = (await detectFaces(small, { key })).slice().sort((a, b) => a.box.x - b.box.x);
  const chosen = new Set(faces.filter((f) => pickPeople([f], o.beauty?.subjects || null, W, H).length).map((f) => faces.indexOf(f)));
  const subjects = () => (chosen.size === faces.length ? null : faces.filter((_, i) => chosen.has(i)).map((f) => subjectOf(f, W, H)));
  const settings = () => ({ ...Object.fromEntries(Object.keys(NONE).map((k) => [k, S[k]])), subjects: subjects() });

  // ---------- Preview ----------
  const view = h('canvas', { class: 'studio-canvas', width: W, height: H });
  const vx = view.getContext('2d');
  vx.drawImage(small, 0, 0);
  let result = null;
  let comparing = false;
  let zoomed = false;
  // The picked people with room for their bodies, for the People view.
  const peopleBox = () => {
    const picked = faces.filter((_, i) => chosen.has(i));
    if (!picked.length) return [0, 0, W, H];
    const fw = Math.max(...picked.map((f) => f.box.w));
    const x0 = Math.max(0, Math.min(...picked.map((f) => f.box.x)) - fw * 2.2);
    const x1 = Math.min(W, Math.max(...picked.map((f) => f.box.x + f.box.w)) + fw * 2.2);
    const y0 = Math.max(0, Math.min(...picked.map((f) => f.box.y)) - fw * 1.2);
    const y1 = Math.min(H, Math.max(...picked.map((f) => f.box.y + f.box.h)) + fw * 7);
    return [x0, y0, x1 - x0, y1 - y0];
  };
  const draw = () => {
    const [sx, sy, sw, sh] = zoomed ? peopleBox() : [0, 0, W, H];
    const k = zoomed ? Math.min(3, 1400 / Math.max(sw, sh)) : 1;
    const cw = Math.round(sw * k);
    const ch = Math.round(sh * k);
    if (view.width !== cw || view.height !== ch) {
      view.width = cw;
      view.height = ch;
    }
    vx.imageSmoothingQuality = 'high';
    vx.clearRect(0, 0, cw, ch);
    vx.drawImage(comparing || !result ? small : result, sx, sy, sw, sh, 0, 0, cw, ch);
    badge.textContent = comparing ? 'Original' : status || '';
    badge.hidden = !badge.textContent;
  };
  let status = '';
  const badge = h('div', { class: 'studio-badge', hidden: true });
  const hold = (on) => () => {
    comparing = on;
    draw();
  };
  const stage = h(
    'div',
    { class: 'studio-stage', onpointerdown: hold(true), onpointerup: hold(false), onpointerleave: hold(false) },
    view,
    badge,
    h('div', { class: 'studio-hint' }, 'Press and hold the photo to see the original'),
  );

  let want = 0;
  let done = 0;
  let running = false;
  let timer = null;
  const say = (t) => {
    status = t;
    draw();
  };
  async function run() {
    if (running) return;
    running = true;
    try {
      while (done < want) {
        const ticket = want;
        say('Updating');
        const r = await renderLook(small, S.glow ? ['glow'] : [], settings(), { key, say: (t) => say(t) });
        if (ticket === want) result = r.canvas;
        done = ticket;
      }
    } catch (e) {
      toast(e.message || String(e), { error: true });
    } finally {
      running = false;
      say('');
    }
  }
  const update = () => {
    want++;
    clearTimeout(timer);
    timer = setTimeout(run, 220);
  };

  // ---------- Controls ----------
  const sliders = {};
  const fields = FIXES.map((f) => {
    const field = rangeField(f.label, S[f.id], (v) => {
      S[f.id] = v;
      update();
    }, { min: 0, max: 100 });
    sliders[f.id] = field;
    return field;
  });
  const setSlider = (id, v) => {
    S[id] = v;
    sliders[id].querySelector('input[type=range]').value = v;
    sliders[id].querySelector('.range-value').textContent = `${v}`;
  };
  const glowBox = h('input', { type: 'checkbox', checked: S.glow, onchange: (e) => ((S.glow = e.target.checked), update()) });

  const people = faces.length > 1
    ? h(
        'div',
        { class: 'studio-section' },
        h('div', { class: 'studio-label' }, 'People'),
        h(
          'div',
          { class: 'studio-people' },
          faces.map((f, i) => {
            const b = h('button', { class: 'studio-person' + (chosen.has(i) ? ' on' : ''), title: `Person ${i + 1} from the left` }, faceThumb(small, f), h('span', {}, `${i + 1}`));
            b.onclick = () => {
              if (chosen.has(i)) chosen.delete(i);
              else chosen.add(i);
              if (!chosen.size) chosen.add(i);
              b.classList.toggle('on', chosen.has(i));
              draw();
              update();
            };
            return b;
          }),
        ),
        h('p', { class: 'muted small' }, 'Only the people picked here get the fixes. Click a face to add or remove it.'),
      )
    : null;

  const viewSeg = h(
    'div',
    { class: 'seg ba-seg' },
    [['Whole photo', false], ['People', true]].map(([text, z]) =>
      h('button', { class: z === zoomed ? 'on' : '', onclick: (e) => ((zoomed = z), [...viewSeg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)), draw()) }, text),
    ),
  );
  const panel = h(
    'div',
    { class: 'studio-panel' },
    faces.length ? h('div', { class: 'studio-section' }, h('div', { class: 'studio-label' }, 'View'), viewSeg) : null,
    people,
    h(
      'div',
      { class: 'studio-section' },
      h('div', { class: 'studio-label' }, 'Fixes'),
      fields,
      h('label', { class: 'check' }, glowBox, 'Glow up light and colour'),
      h(
        'div',
        { class: 'row' },
        h('button', {
          class: 'btn small grow',
          onclick: () => {
            for (const [k, v] of Object.entries(PRESETS.glow.set)) setSlider(k, v);
            S.glow = glowBox.checked = true;
            update();
          },
        }, 'Glow up'),
        h('button', {
          class: 'btn small grow',
          onclick: () => {
            for (const k of Object.keys(NONE)) setSlider(k, 0);
            S.glow = glowBox.checked = false;
            update();
          },
        }, 'Clear all'),
      ),
    ),
    h('button', {
      class: 'btn small',
      title: 'The Quick fixes buttons apply these amounts from now on',
      onclick: async () => {
        const keep = Object.fromEntries(Object.keys(NONE).filter((k) => S[k] > 0).map((k) => [k, S[k]]));
        if (!Object.keys(keep).length) return toast('Set a slider above 0 first.', { error: true });
        await saveDefaults('quickFix', keep);
        toast('Saved as default. The Quick fixes buttons now apply these amounts.');
      },
    }, 'Save as default'),
  );

  // ---------- Window ----------
  return new Promise((resolve) => {
    const close = async (apply) => {
      document.removeEventListener('keydown', key2, true);
      back.remove();
      if (!apply) return resolve(false);
      try {
        const r = await quickFix(o, ['glow'], { on: S.glow, amounts: Object.fromEntries(Object.keys(NONE).map((k) => [k, S[k]])), subjects: subjects() });
        toast(r.message);
      } catch (e) {
        toast(e.message || String(e), { error: true });
      }
      resolve(true);
    };
    const key2 = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    const back = h(
      'div',
      { class: 'modal-back studio-back' },
      h(
        'div',
        { class: 'studio' },
        h('div', { class: 'modal-head' }, h('h2', {}, `Retouch studio: ${o.name || 'Photo'}`)),
        h('div', { class: 'studio-body' }, stage, panel),
        h(
          'div',
          { class: 'modal-foot' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(true) }, 'Apply'),
        ),
      ),
    );
    document.body.appendChild(back);
    document.addEventListener('keydown', key2, true);
    if (Object.keys(NONE).some((k) => S[k] > 0) || S.glow) update();
  });
}
