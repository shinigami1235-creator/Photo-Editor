import { state, currentPage, uid } from './state.js';
import { fabric } from './canvas.js';
import { syncCurrentPage, addPage } from './pages.js';
import { pageImage, renderPage, MIME } from './exporter.js';
import { allLogos } from './brand.js';
import { framedImage, isPhoto, isEmptyFrame } from './frames.js';
import { applyCurve } from './objects.js';
import { pickFiles, pickFolder, writeFile, joinPath, baseName, dataReadJson, isDesktop, readPath } from './platform.js';
import { registerBytes, typeFor } from './assets.js';
import { h, modal, toast } from './ui.js';

// Batch export: one image per row from the current page, with chosen text and
// photos swapped per row. Useful for a price list, a set of product posts, or
// one post per treatment. The rows can come from a spreadsheet saved as CSV,
// matched to layers by name or to {{Column}} placeholders in the text, the
// way DesignCraft's data merge works.

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
  const placeholders = [...new Set(page.objects.filter(isTextJson).flatMap((o) => [...o.text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1])))];
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
        'Tick the text and photos that change, or load a spreadsheet whose column names match the layer names. Each row becomes one image, and anything left empty keeps what the page has.',
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn small', title: 'A CSV file saved from Excel or Google Sheets, with column names in the first row', onclick: loadCsv }, 'Load spreadsheet (CSV)'), S.csv ? h('span', { class: 'muted small' }, `Columns: ${S.csv.headers.join(', ')}`) : null),
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
    if (placeholders.length)
      body.append(h('p', { class: 'muted small' }, `The text uses ${placeholders.map((x) => `{{${x}}}`).join(', ')}. A spreadsheet column with the same name fills each one.`));
    if (!fields.length && !S.csv) return;

    const table = h(
      'table',
      { class: 'batch-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '#'), placeholders.filter((x) => S.csv?.headers.includes(x)).map((x) => h('th', {}, `{{${x}}}`)), fields.map((f) => h('th', {}, f.label.split(':')[0])), h('th', {}, 'File name'), h('th', {}, ''))),
      h(
        'tbody',
        {},
        S.rows.map((r, i) =>
          h(
            'tr',
            { class: i === S.previewRow ? 'on' : '', onclick: () => ((S.previewRow = i), draw(), showPreview()) },
            h('td', { class: 'muted' }, String(i + 1)),
            placeholders.filter((x) => S.csv?.headers.includes(x)).map((x) => h('td', { class: 'small' }, r.cols?.[x] ?? '')),
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
        : '',
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

  async function loadCsv() {
    const files = await pickFiles({ extensions: ['csv', 'tsv', 'txt'], label: 'Spreadsheet (CSV)' });
    if (!files?.length) return;
    const table = parseCsv(new TextDecoder().decode(files[0].bytes));
    if (table.length < 2) return toast('The file needs a row of column names and at least one row below it.', { error: true });
    const headers = table[0].map((x) => x.trim());
    const rows = table.slice(1).filter((r) => r.some((c) => c.trim()));
    const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
    // Columns match layers by name, or a text layer by its first words.
    const match = new Map();
    for (const c of candidates) {
      const layer = page.objects.find((o) => o.uid === c.uid);
      // Text with {{Column}} placeholders is filled in place, not replaced whole.
      if (c.kind === 'text' && /\{\{/.test(c.value || '')) continue;
      const keys = [norm(layer?.name || ''), norm(c.label.split(':')[0]), norm((c.value || '').split('\n')[0])];
      const col = headers.findIndex((hd) => keys.includes(norm(hd)) && norm(hd));
      if (col >= 0) match.set(c.uid, col);
    }
    const used = new Set(match.values());
    const nameCol = ['filename', 'file', 'output', 'name'].map((k) => headers.findIndex((hd, i) => norm(hd) === k && !used.has(i))).find((i) => i >= 0) ?? -1;
    S.fields = [...new Set([...S.fields, ...match.keys()])];
    // Photos named in the sheet: read them by path on the desktop, or pick them.
    const photoCols = [...match.entries()].filter(([u]) => candidates.find((c) => c.uid === u).kind === 'photo');
    const picked = new Map();
    if (photoCols.length) {
      const wanted = new Set(rows.flatMap((r) => photoCols.map(([, col]) => (r[col] || '').trim())).filter(Boolean));
      if (isDesktop) {
        for (const w of wanted) {
          try {
            picked.set(w, registerBytes(await readPath(w), typeFor(w)));
          } catch {
            /* not a full path; picked below */
          }
        }
      }
      if ([...wanted].some((w) => !picked.has(w))) {
        toast('Pick the photos named in the spreadsheet.');
        const imgs = await pickFiles({ extensions: ['png', 'jpg', 'jpeg', 'webp'], multiple: true, label: 'Photos for the spreadsheet' });
        for (const f of imgs || []) picked.set(f.name.toLowerCase(), registerBytes(f.bytes, typeFor(f.name)));
      }
    }
    S.csv = { headers };
    S.rows = rows.map((r) => {
      const values = {};
      for (const [u, col] of match) {
        const v = (r[col] ?? '').trim();
        if (!v) continue;
        if (candidates.find((c) => c.uid === u).kind === 'photo') {
          const url = picked.get(v) || picked.get(baseName(v).toLowerCase());
          if (url) values[u] = url;
        } else values[u] = v;
      }
      const cols = Object.fromEntries(headers.map((hd, k) => [hd, (r[k] ?? '').trim()]));
      return { values, cols, name: nameCol >= 0 ? (r[nameCol] || '').trim() : '' };
    });
    S.previewRow = 0;
    const missing = headers.filter((hd, k) => !used.has(k) && k !== nameCol && !placeholders.includes(hd));
    toast(`${S.rows.length} rows loaded.${missing.length ? ` Not used: ${missing.join(', ')}.` : ''}`);
    draw();
    showPreview();
  }

  async function addRowsAsPages() {
    const note = toast('Adding pages', { sticky: true });
    try {
      let at = state.pageIndex + 1;
      for (let i = 0; i < S.rows.length; i++) {
        note.text(`Adding page ${i + 1} of ${S.rows.length}`);
        const objects = await transformFor(S.rows[i])(await fabric.util.enlivenObjects(page.objects));
        await addPage({ id: uid(), background: page.background, objects: objects.map((o) => o.toObject()), thumb: null }, at++);
      }
      note.done();
      toast(`Added ${S.rows.length} pages. Export with All pages to save them.`);
    } catch (e) {
      note.done();
      toast(`The pages could not be added: ${e.message || e}`, { error: true });
    }
  }

  const transformFor = (row) => async (objects) => {
    const out = [...objects];
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      if (o.type === 'textbox' && row.cols && /\{\{/.test(o.text)) {
        o.set({ text: o.text.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, k) => row.cols[k] ?? row.cols[Object.keys(row.cols).find((x) => x.toLowerCase() === k.toLowerCase())] ?? m) });
        o.initDimensions();
        if (o.curve) applyCurve(o);
      }
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
  const go = await modal('Batch export and spreadsheet posts', body, [
    { label: 'Cancel', value: false },
    { label: 'Add as pages', value: 'pages' },
    { label: 'Export all', value: true, primary: true },
  ], { wide: true });
  if (!go || (!S.fields.length && !S.csv)) return;
  if (go === 'pages') return addRowsAsPages();

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

/** Reads CSV or tab-separated text into rows of cells. Handles quotes and line breaks inside quotes. */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
