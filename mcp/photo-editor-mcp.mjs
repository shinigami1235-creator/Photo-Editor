#!/usr/bin/env node
// Claude connector for Photo Editor. The Claude desktop app starts this file
// and talks to it over stdin and stdout (MCP). Each tool call is passed to the
// running Photo Editor through its local server, which only runs while
// Help > Let Claude control this app is ticked. No packages needed, Node 18+.

import { readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const APP_ID = 'com.cygnussolutions.photoeditor';
const VERSION = '1.0.0';

function infoFile() {
  if (process.env.PHOTO_EDITOR_MCP_INFO) return process.env.PHOTO_EDITOR_MCP_INFO;
  const p = platform();
  if (p === 'win32') return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), APP_ID, 'mcp.json');
  if (p === 'darwin') return join(homedir(), 'Library', 'Application Support', APP_ID, 'mcp.json');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), APP_ID, 'mcp.json');
}

const NOT_RUNNING = 'Photo Editor is closed or Claude control is off. Open Photo Editor and tick Help > Let Claude control this app, then try again.';

async function call(method, params) {
  let info;
  try {
    info = JSON.parse(readFileSync(infoFile(), 'utf8'));
  } catch {
    throw new Error(NOT_RUNNING);
  }
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-token': info.token },
      body: JSON.stringify({ method, params }),
      signal: AbortSignal.timeout(6 * 60 * 1000),
    });
  } catch {
    throw new Error(NOT_RUNNING);
  }
  const data = await res.json().catch(() => ({ error: `Photo Editor answered ${res.status}.` }));
  if (data.error) throw new Error(data.error);
  return data;
}

// ---------- Tool list ----------

const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const LAYER_PROPS = {
  name: str('Layer name shown in the Layers panel.'),
  visible: bool('Show or hide the layer.'),
  locked: bool('Lock the layer so it cannot be moved.'),
  opacity: num('0 to 100.'),
  blend: str('Normal, Multiply, Screen, Overlay, Darken, Lighten, Colour dodge, Colour burn, Hard light, Soft light, Difference, Exclusion, Hue, Saturation, Colour or Luminosity.'),
  x: num('Left edge of the layer box in page pixels.'),
  y: num('Top edge of the layer box in page pixels.'),
  width: num('Box width in page pixels. For text this is the wrap width.'),
  height: num('Box height in page pixels (not for text).'),
  keep_proportions: bool('When only one of width or height is given, scale the other with it. Default true.'),
  angle: num('Rotation in degrees.'),
  flip_x: bool('Mirror left to right.'),
  flip_y: bool('Mirror top to bottom.'),
  color: str('Fill colour as #rrggbb (text colour for text, line colour for lines).'),
  outline_color: str('Outline or border colour.'),
  outline_width: num('Outline or border width in pixels. 0 removes it.'),
  corner_radius: num('Rounded corners for rectangles, in pixels.'),
  shadow: { description: 'Drop shadow { color, blur, x, y }, or null to remove it.', anyOf: [{ type: 'object', properties: { color: { type: 'string' }, blur: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' } } }, { type: 'null' }] },
  order: str('front, back, forward or backward in the layer stack.'),
  text: str('Text content (text layers).'),
  font_family: str('Font name installed on the computer or added to Photo Editor, such as Georgia or Cinzel.'),
  font_size: num('Font size in page pixels.'),
  font_weight: str('normal or bold (or 100 to 900).'),
  italic: bool('Italic text.'),
  align: str('left, center, right or justify.'),
  letter_spacing: num('Letter spacing in thousandths of an em, such as 40.'),
  line_height: num('Line height as a multiple, such as 1.2.'),
  curve: num('Bend one line of text: -100 to 100, 0 is straight.'),
};
const ADJUST_HELP =
  'Photo settings, all optional. Light: exposure, brightness, contrast, highlights, shadows, whites, blacks (-100 to 100). Colour: saturation, vibrance, warmth, tint (-100 to 100). Detail: clarity, texture, dehaze (-100 to 100), sharpen, denoise, colorNoise, blur, grain, vignette, fade (0 to 100), motion, motionAngle, tilt, tiltPos, tiltBand, pixelate. Mixer: { mixer: { hue: { Red: -40 }, sat: { Blue: 20 }, lum: { Orange: 10 } } } with bands Red, Orange, Yellow, Green, Aqua, Blue, Purple, Magenta. Black and white: bw true plus bwMix { Red: 20 }. Grading: shadowsColor, shadowsAmount, highlightsColor, highlightsAmount, balance. Photo filter: filterColor, filterAmount. Look: lut with a built-in look name and lutAmount 0 to 100. Levels: { levels: { black, gamma, white } }.';

const TOOLS = [
  { name: 'get_status', description: 'The open design: name, file, size, page, layer count, selected layer ids and whether it has unsaved changes. Call this first.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_layers', description: 'Every layer on the current page, top first, with id, name, kind, position, size, opacity, blend, text, font, colour, masks and photo adjustments. Use the ids in other tools.', inputSchema: { type: 'object', properties: {} } },
  { name: 'preview', description: 'A picture of the current page as it will export. Call it after changes to check the result.', inputSchema: { type: 'object', properties: { max_size: num('Longest side in pixels, 128 to 2048. Default 1024.') } } },
  { name: 'open_file', description: 'Open a design (.zip), a picture (PNG, JPG, WebP) or a camera RAW file from a full path. A picture opens as a new design at its own size.', inputSchema: { type: 'object', properties: { path: str('Full path on the computer.'), discard_changes: bool('Open even if the current design has unsaved changes.') }, required: ['path'] } },
  { name: 'new_design', description: 'Start a new blank design. Instagram post 1080 × 1350, square 1080 × 1080, story 1080 × 1920, A4 at 300 dpi 2480 × 3508.', inputSchema: { type: 'object', properties: { width: num('Pixels.'), height: num('Pixels.'), name: str('Design name.'), background: str('Page colour, #rrggbb.'), discard_changes: bool('Start even if the current design has unsaved changes.') } } },
  { name: 'go_to_page', description: 'Show another page of the design.', inputSchema: { type: 'object', properties: { page: num('Page number from 1.') }, required: ['page'] } },
  { name: 'place_photo', description: 'Add a picture from disk as a new photo layer.', inputSchema: { type: 'object', properties: { path: str('Full path of the picture.'), fit: str('cover fills the page, contain fits inside it. Leave out to place it at 60% size.'), x: num('Left edge.'), y: num('Top edge.'), width: num('Width in page pixels.'), height: num('Height in page pixels.'), name: str('Layer name.') }, required: ['path'] } },
  { name: 'select_layers', description: 'Select layers in the editor, as clicking them would. Some menu commands act on the selection.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Layer ids. Empty clears the selection.' } }, required: ['ids'] } },
  { name: 'set_layer', description: 'Change a layer: name, visibility, lock, opacity, blend, position, size, rotation, colour, outline, shadow, stacking order, and for text the words, font, size, weight, alignment, spacing and curve.', inputSchema: { type: 'object', properties: { id: str('Layer id or exact name.'), ...LAYER_PROPS }, required: ['id'] } },
  { name: 'add_text', description: 'Add a text layer. Takes the same settings as set_layer.', inputSchema: { type: 'object', properties: { text: str('The words.'), style: str('heading or body. Default heading.'), ...LAYER_PROPS } , required: ['text'] } },
  { name: 'add_shape', description: 'Add a shape layer. Takes the same settings as set_layer.', inputSchema: { type: 'object', properties: { shape: str('rect, rounded, ellipse, triangle, line, star, burst (badge), polygon, arrow, heart, bubble (speech bubble) or cross (plus).'), ...LAYER_PROPS }, required: ['shape'] } },
  { name: 'duplicate_layer', description: 'Copy a layer.', inputSchema: { type: 'object', properties: { id: str('Layer id.') }, required: ['id'] } },
  { name: 'delete_layers', description: 'Delete layers. Undo with run_command edit.undo.', inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] } },
  { name: 'adjust_photo', description: 'Change one photo layer the way the Adjust panel does. Settings merge with what the photo already has.', inputSchema: { type: 'object', properties: { id: str('Photo layer id.'), settings: { type: 'object', description: ADJUST_HELP }, auto: str('tone, colour or both: the Auto button.'), reset: bool('Clear all adjustments first.'), lut_file: str('Full path of a .cube colour look to apply.') }, required: ['id'] } },
  { name: 'add_adjustment_layer', description: 'Add an adjustment layer that changes every layer below it (or only the layer below). Kinds: brightness, levels, curves, exposure, vibrance, hsl (colour mixer), grading, bw (black and white), filter (photo filter), lut (colour lookup), detail (clarity and dehaze), blur.', inputSchema: { type: 'object', properties: { kind: str('Adjustment kind.'), settings: { type: 'object', description: ADJUST_HELP }, above: str('Layer id to put it directly above. Default top of the stack.'), only_layer_below: bool('Change only the layer directly below.'), name: str('Layer name.'), lut_file: str('Full path of a .cube file for a colour lookup layer.') }, required: ['kind'] } },
  { name: 'remove_background', description: 'Find the person or product in a photo with the AI model and hide the background with a layer mask. Takes 10 to 60 seconds.', inputSchema: { type: 'object', properties: { id: str('Photo layer id.'), as_new_layer: bool('Keep the original and make a cut-out copy on top.') }, required: ['id'] } },
  { name: 'text_behind_subject', description: 'Copy the subject of a photo to a layer in front and put a heading between, so the text sits behind the person or product.', inputSchema: { type: 'object', properties: { id: str('Photo layer id.'), text: str('Heading text. Uses the text layer above the photo if there is one.') }, required: ['id'] } },
  { name: 'upscale', description: 'Make a photo 2 or 4 times sharper with the built-in Real-ESRGAN model. It keeps its size on the page.', inputSchema: { type: 'object', properties: { id: str('Photo layer id.'), factor: num('2 or 4.') }, required: ['id'] } },
  { name: 'list_commands', description: 'Menu commands Photo Editor can run, with their menu path and whether they can run now. Includes layer styles, filters, align, arrange, masks, undo and redo.', inputSchema: { type: 'object', properties: { filter: str('Part of a name or menu, such as style, align or mask.') } } },
  { name: 'run_command', description: 'Run a menu command by id, such as layer.style.shadow, layer.alignC, filter.dehaze, edit.undo. Select the layers first with layer_ids.', inputSchema: { type: 'object', properties: { id: str('Command id from list_commands.'), layer_ids: { type: 'array', items: { type: 'string' }, description: 'Layers to select before running.' } }, required: ['id'] } },
  { name: 'save_design', description: 'Save the design as an editable .zip. Without a path it saves over its own file.', inputSchema: { type: 'object', properties: { path: str('Full path ending in .zip.'), overwrite: bool('Replace a different file that already exists.') } } },
  { name: 'export_image', description: 'Export the current page, or every page into a folder, as PNG, JPG or WebP.', inputSchema: { type: 'object', properties: { path: str('Full file path, or a folder when pages is all.'), format: str('png, jpg or webp. Taken from the file name when left out.'), scale: num('1 or 2.'), quality: num('0.1 to 1 for jpg and webp. Default 0.92.'), transparent: bool('Transparent background for png and webp.'), pages: str('current or all.'), overwrite: bool('Replace files that already exist.') }, required: ['path'] } },
];

const INSTRUCTIONS =
  'Controls the Photo Editor app on Gid\'s computer. Start with get_status and list_layers, use layer ids from list_layers, and call preview after a change to look at the result before saying it is done. Photo Editor must be open with Help > Let Claude control this app ticked. Never overwrite or discard Gid\'s files without being asked.';

// ---------- MCP over stdio ----------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function onMessage(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'photo-editor', version: VERSION },
          instructions: INSTRUCTIONS,
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const name = params?.name;
      if (!TOOLS.some((t) => t.name === name)) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool ${name}` } });
      try {
        const r = await call(name, params.arguments || {});
        const content = [];
        if (r.text) content.push({ type: 'text', text: r.text });
        if (r.image) {
          const [, mime, data] = r.image.match(/^data:([^;]+);base64,(.*)$/) || [];
          if (data) content.push({ type: 'image', mimeType: mime, data });
        }
        if (!content.length) content.push({ type: 'text', text: 'Done.' });
        return send({ jsonrpc: '2.0', id, result: { content } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }
    if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
    if (method === 'prompts/list') return send({ jsonrpc: '2.0', id, result: { prompts: [] } });
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: String(e?.message || e) } });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    onMessage(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
