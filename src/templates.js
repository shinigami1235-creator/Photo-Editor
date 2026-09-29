import { dataReadJson, dataWriteJson, dataRead, dataWrite, dataDelete } from './platform.js';
import { state, currentPage, uid, emit } from './state.js';
import { buildZip, readZip } from './project.js';
import { thumbnail } from './exporter.js';
import { syncCurrentPage, addPage, scaleObjectJson } from './pages.js';
import { BEFORE_AFTER, useBeforeAfter, beforeAfterIcon } from './layouts.js';
import { h, modal, prompt, toast } from './ui.js';
import { loadObjects } from './canvas.js';
import { record } from './history.js';

// Templates are saved pages. Each is a one-page design file in templates/.

let index = [];

export async function initTemplates() {
  index = await dataReadJson('templates/index.json', []);
  emit('templates');
}

export async function saveTemplate() {
  const name = await prompt('Save page as template', 'Name', `${state.doc.name} ${state.pageIndex + 1}`);
  if (!name) return;
  syncCurrentPage();
  const page = currentPage();
  const id = uid();
  const zip = await buildZip({ ...state.doc, name }, [page]);
  await dataWrite(`templates/${id}.zip`, zip);
  index.unshift({ id, name, width: state.doc.width, height: state.doc.height, thumb: await thumbnail(page, 240) });
  await dataWriteJson('templates/index.json', index);
  emit('templates');
  toast(`Template ${name} saved.`);
}

export async function deleteTemplate(id) {
  const t = index.find((x) => x.id === id);
  if (!t) return;
  const ok = await modal('Delete template', h('p', {}, `Delete the template ${t.name}?`), [
    { label: 'Cancel', value: false },
    { label: 'Delete', value: true, primary: true },
  ]);
  if (!ok) return;
  index = index.filter((x) => x.id !== id);
  await dataWriteJson('templates/index.json', index);
  await dataDelete(`templates/${id}.zip`).catch(() => {});
  emit('templates');
}

/** Adds the template as a new page, scaled to fit when its size differs from the design. */
export async function useTemplate(id) {
  const bytes = await dataRead(`templates/${id}.zip`);
  if (!bytes) return toast('The template file is missing.', { error: true });
  const tdoc = await readZip(bytes);
  const src = tdoc.pages[0];
  let objects = src.objects;
  if (tdoc.width !== state.doc.width || tdoc.height !== state.doc.height) {
    const s = Math.min(state.doc.width / tdoc.width, state.doc.height / tdoc.height);
    const ox = (state.doc.width - tdoc.width * s) / 2;
    const oy = (state.doc.height - tdoc.height * s) / 2;
    objects = objects.map((o) => scaleObjectJson(o, s, ox, oy));
  }
  syncCurrentPage();
  // A blank page is filled in place rather than left behind.
  if (!currentPage().objects.length) {
    currentPage().background = src.background;
    currentPage().objects = objects;
    await loadObjects(objects);
    record(true);
    emit('page-props');
    return;
  }
  await addPage({ id: uid(), background: src.background, objects, thumb: null });
}

export function renderTemplatesPanel(el) {
  el.innerHTML = '';
  el.append(
    h(
      'div',
      { class: 'panel-block' },
      h('div', { class: 'section-title' }, 'Before and after'),
      h(
        'div',
        { class: 'layout-row' },
        BEFORE_AFTER.map((l) => h('button', { class: 'layout-tile', title: l.name, onclick: () => useBeforeAfter(l.id) }, h('span', { html: beforeAfterIcon(l.id) }), h('span', { class: 'small' }, l.name))),
      ),
    ),
    h('div', { class: 'panel-block' }, h('div', { class: 'section-title' }, 'My templates'), h('button', { class: 'btn wide', onclick: saveTemplate }, 'Save page as template')),
  );
  if (!index.length) {
    el.append(h('p', { class: 'muted pad' }, 'Saved templates show here.'));
    return;
  }
  el.append(
    h(
      'div',
      { class: 'template-grid' },
      index.map((t) =>
        h(
          'div',
          { class: 'template-tile', title: `${t.name}, ${t.width} × ${t.height}` },
          h('img', { src: t.thumb, onclick: () => useTemplate(t.id) }),
          h('div', { class: 'template-name' }, t.name),
          h('button', { class: 'tile-x', title: 'Delete template', onclick: () => deleteTemplate(t.id), html: '&times;' }),
        ),
      ),
    ),
  );
}
