import { state, currentPage } from './state.js';
import { syncCurrentPage } from './pages.js';
import { pageImage, renderPage, MIME } from './exporter.js';
import { allLogos } from './brand.js';
import { framedImage, isPhoto, isEmptyFrame } from './frames.js';
import { applyCurve } from './objects.js';
import { pickFiles, pickFolder, writeFile, joinPath, baseName, dataReadJson } from './platform.js';
import { registerBytes, typeFor } from './assets.js';
import { h, modal, toast } from './ui.js';

// Batch export: one image per row from the current page, with chosen text and
// photos swapped per row. Useful for a price list, a set of product posts, or
// one post per treatment.

const safe = (s) => String(s).replace(/[\\/:*?"<>|]/g, '_').trim();

export async function batchDialog() {
  syncCurrentPage();
  const page = currentPage();
  const candidates = page.objects
    .filter((o) => isTextJson(o) || isPhotoJson(o))
    .map((o) => ({
      uid: o.uid,
      kind: isTextJson(o) ? 'text' : 'photo',
      label: isTextJson(o) ? `${o.name || 'Text'}: ${o.text.split('\n')[0].slice(0, 24)}` : o.name || 'Photo',
      value: isTextJson(o) ? o.text : null,
    }));
  if (!candidates.length) {
    await modal('Batch export', h('p', {}, 'Add text or a photo to the page first. Batch export changes them for each row.'));
    return;
  }

  const S = {
    fields: [],
    rows: [{ values: {}, name: '' }],
    format: 'png',
    multiplier: 1,
    previewRow: 0,
    watermark: false,
  };
  const saved = await dataReadJson('export-settings.json', {});
  const wm = saved.watermark?.text || saved.watermark?.logoId ? saved.watermark : null;

  const body = h('div', { class: 'batch' });
  const preview = h('div', { class: 'batch-preview' });

  const draw = () => {
    body.innerHTML = '';
    const fields = candidates.filter((c) => S.fields.includes(c.uid));
    body.append(
      h(
        'p',
        { class: 'muted' },
        'Tick the text and photos that change. Each row in the table becomes one image, and anything left empty keeps what the page has.',
      ),
      h(
        'div',
        { class: 'batch-fields' },
        candidates.map((c) =>
          h(
            'label',
            { class: 'check' },
            h('input', {
              type: 'checkbox',
              checked: S.fields.includes(c.uid),
              onchange: (e) => {
                S.fields = e.target.checked ? [...S.fields, c.uid] : S.fields.filter((u) => u !== c.uid);
                draw();
              },
            }),
            h('span', { class: 'batch-kind' }, c.kind === 'text' ? 'Text' : 'Photo'),
            c.label,
          ),
        ),
      ),
    );
    if (!fields.length) return;

    const table = h(
      'table',
      { class: 'batch-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), fields.map((f) => h('th', {}, f.label.split(':')[0])), h('th', {}, 'File name'), h('th', {}, ''))),
      h(
        'tbody',
        {},
        S.rows.map((r, i) =>
          h(
            'tr',
            { class: i === S.previewRow ? 'on' : '', onclick: () => ((S.previewRow = i), draw(), showPreview()) },
            h('td', { class: 'muted' }, String(i + 1)),
            fields.map((f) =>
              h(
                'td',
                {},
                f.kind === 'text'
                  ? h('input', {
                      class: 'field',
                      value: r.values[f.uid] ?? '',
                      placeholder: f.value.split('\n')[0],
                      onchange: (e) => {
                        r.values[f.uid] = e.target.value;
                        if (i === S.previewRow) showPreview();
                      },
                    })
                  : h(
                      'button',
                      {
                        class: 'batch-photo',
                        title: 'Choose photo',
                        onclick: async (e) => {
                          e.stopPropagation();
                          const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp'], label: 'Images' });
                          if (!files?.length) return;
                          r.values[f.uid] = registerBytes(files[0].bytes, typeFor(files[0].name));
                          S.previewRow = i;
                          draw();
                          showPreview();
                        },
                      },
                      r.values[f.uid] ? h('img', { src: r.values[f.uid] }) : 'Choose',
                    ),
              ),
            ),
            h(
              'td',
              {},
              h('input', {
                class: 'field',
                value: r.name,
                placeholder: `${safe(state.doc.name)}-${String(i + 1).padStart(2, '0')}`,
                onchange: (e) => (r.name = e.target.value),
              }),
            ),
            h(
              'td',
              {},
              h('button', {
                class: 'icon-btn tiny',
                title: 'Remove row',
                html: '&times;',
                onclick: (e) => {
                  e.stopPropagation();
                  S.rows.splice(i, 1);
                  if (!S.rows.length) S.rows.push({ values: {}, name: '' });
                  S.previewRow = Math.min(S.previewRow, S.rows.length - 1);
                  draw();
                  showPreview();
                },
              }),
            ),
          ),
        ),
      ),
    );

    const photoFields = fields.filter((f) => f.kind === 'photo');
    const textFields = fields.filter((f) => f.kind === 'text');
    body.append(
      h('div', { class: 'batch-grid' }, h('div', { class: 'batch-table-wrap' }, table), preview),
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn small', onclick: () => (S.rows.push({ values: {}, name: '' }), draw()) }, 'Add row'),
        textFields.length ? h('button', { class: 'btn small', onclick: () => pasteRows(textFields) }, 'Paste rows') : null,
        photoFields.map((f) =>
          h(
            'button',
            {
              class: 'btn small',
              onclick: async () => {
                const files = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp'], multiple: true, label: 'Images' });
                if (!files?.length) return;
                files.forEach((file, k) => {
                  if (!S.rows[k]) S.rows.push({ values: {}, name: '' });
                  S.rows[k].values[f.uid] = registerBytes(file.bytes, typeFor(file.name));
                  if (!S.rows[k].name) S.rows[k].name = file.name.replace(/\.[^.]+$/, '');
                });
                draw();
                showPreview();
              },
            },
            `Fill ${f.label} from files`,
          ),
        ),
      ),
      h(
        'div',
        { class: 'field-row' },
        h('span', { class: 'label' }, 'Format'),
        seg('format', [
          ['png', 'PNG'],
          ['jpg', 'JPG'],
          ['webp', 'WebP'],
        ]),
      ),
      wm
        ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.watermark, onchange: (e) => (S.watermark = e.target.checked) }), 'Watermark, as set in Export')
        : null,
      h(
        'div',
        { class: 'field-row' },
        h('span', { class: 'label' }, 'Size'),
        seg('multiplier', [
          [1, `1× (${state.doc.width} × ${state.doc.height})`],
          [2, `2× (${state.doc.width * 2} × ${state.doc.height * 2})`],
        ]),
      ),
    );
  };

  const seg = (key, items) =>
    h(
      'div',
      { class: 'seg' },
      items.map(([v, label]) => h('button', { class: S[key] === v ? 'on' : '', onclick: () => ((S[key] = v), draw()) }, label)),
    );

  async function pasteRows(textFields) {
    const area = h('textarea', { class: 'field', rows: 8, placeholder: textFields.map((f) => f.label.split(':')[0]).join('\t') });
    const ok = await modal(
      'Paste rows',
      h(
        'div',
        { class: 'stack gap' },
        h('p', { class: 'muted small' }, `Paste from Excel or Google Sheets, one row per line. Columns go in this order: ${textFields.map((f) => f.label.split(':')[0]).join(', ')}.`),
        area,
      ),
      [
        { label: 'Cancel', value: false },
        { label: 'Add rows', value: true, primary: true },
      ],
    );
    if (!ok) return;
    const lines = area.value.split(/\r?\n/).filter((l) => l.trim());
    const start = S.rows.length === 1 && !Object.keys(S.rows[0].values).length ? 0 : S.rows.length;
    lines.forEach((line, k) => {
      const cells = line.includes('\t') ? line.split('\t') : line.split(',');
      const row = S.rows[start + k] || (S.rows[start + k] = { values: {}, name: '' });
      textFields.forEach((f, j) => {
        if (cells[j] != null && cells[j].trim()) row.values[f.uid] = cells[j].trim();
      });
    });
    draw();
    showPreview();
  }

  const transformFor = (row) => async (objects) => {
    const out = [...objects];
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const v = row.values[o.uid];
      if (v == null || v === '') continue;
      if (o.type === 'textbox') {
        o.set({ text: v });
        o.initDimensions();
        if (o.curve) applyCurve(o);
      } else if (isPhoto(o) || isEmptyFrame(o)) {
        out[i] = await framedImage(o, v);
      }
    }
    return out;
  };

  let previewJob = 0;
  async function showPreview() {
    const job = ++previewJob;
    const row = S.rows[S.previewRow];
    if (!row) return;
    const m = 260 / Math.max(state.doc.width, state.doc.height);
    const el = await renderPage(page, m, { transform: transformFor(row) });
    if (job !== previewJob) return;
    preview.innerHTML = '';
    preview.append(h('div', { class: 'label' }, `Row ${S.previewRow + 1}`), el);
  }

  draw();
  showPreview();
  const go = await modal('Batch export', body, [
    { label: 'Cancel', value: false },
    { label: 'Export all', value: true, primary: true },
  ], { wide: true });
  if (!go || !S.fields.length) return;

  const dir = await pickFolder();
  if (dir == null) return;
  const note = toast('Exporting', { sticky: true });
  try {
    const used = new Set();
    for (let i = 0; i < S.rows.length; i++) {
      note.text(`Exporting ${i + 1} of ${S.rows.length}`);
      note.progress((i + 1) / S.rows.length);
      let name = safe(S.rows[i].name) || `${safe(state.doc.name)}-${String(i + 1).padStart(2, '0')}`;
      while (used.has(name)) name += '-2';
      used.add(name);
      const watermark = S.watermark && wm ? { ...wm, on: true, logoUrl: allLogos().find((l) => l.id === wm.logoId)?.url } : null;
      const bytes = await pageImage(page, { format: S.format, multiplier: S.multiplier, quality: 0.92, transform: transformFor(S.rows[i]), watermark });
      await writeFile(joinPath(dir, `${name}.${S.format}`), bytes, MIME[S.format]);
    }
    note.done();
    toast(`Exported ${S.rows.length} images${dir ? ' to ' + baseName(dir) : ''}.`);
  } catch (e) {
    note.done();
    toast(`Batch export failed: ${e.message || e}`, { error: true });
  }
}

const isTextJson = (o) => String(o.type).toLowerCase() === 'textbox';
const isPhotoJson = (o) => String(o.type).toLowerCase() === 'image' || !!o.isFrame;
