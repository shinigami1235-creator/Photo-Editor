import { PDFDocument, PDFName, PDFString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib';
import wasmUrl from 'lcms-wasm/dist/lcms.wasm?url';

// CMYK for print, with LittleCMS and the ECI press profiles. The page is drawn
// in RGB, converted to CMYK through the chosen profile, and written into the PDF
// as a CMYK image with the profile attached as the output intent.

export const PROFILES = [
  { id: 'coated', name: 'Coated paper, ISO Coated v2 (FOGRA39)', file: 'icc/ISOcoated_v2_eci.icc', condition: 'FOGRA39' },
  { id: 'uncoated', name: 'Uncoated paper, PSO Uncoated (FOGRA47)', file: 'icc/PSOuncoated_ISO12647_eci.icc', condition: 'FOGRA47' },
];

let lcms = null;
const profileCache = new Map();

async function engine() {
  if (lcms) return lcms;
  const mod = await import('lcms-wasm');
  lcms = await mod.instantiate({ locateFile: () => wasmUrl });
  lcms.consts = mod;
  return lcms;
}

async function profile(p) {
  if (profileCache.has(p.id)) return profileCache.get(p.id);
  const res = await fetch(new URL(p.file, document.baseURI));
  if (!res.ok) throw new Error(`${p.file} is missing`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const L = await engine();
  const handle = L.cmsOpenProfileFromMem(bytes, bytes.byteLength);
  if (!handle) throw new Error(`${p.file} could not be read`);
  const entry = { handle, bytes };
  profileCache.set(p.id, entry);
  return entry;
}

const rgbOf = (rgba) => {
  const n = rgba.length / 4;
  const rgb = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    // Transparent areas print as paper white.
    const a = rgba[i * 4 + 3] / 255;
    rgb[i * 3] = rgba[i * 4] * a + 255 * (1 - a);
    rgb[i * 3 + 1] = rgba[i * 4 + 1] * a + 255 * (1 - a);
    rgb[i * 3 + 2] = rgba[i * 4 + 2] * a + 255 * (1 - a);
  }
  return rgb;
};

/** RGBA pixels to CMYK bytes (4 per pixel, 0 = no ink). */
export async function toCmyk(rgba, p, intent = 'perceptual') {
  const L = await engine();
  const { consts } = L;
  const srgb = L.cmsCreate_sRGBProfile();
  const out = await profile(p);
  const t = L.cmsCreateTransform(srgb, consts.TYPE_RGB_8, out.handle, consts.TYPE_CMYK_8, intentOf(consts, intent), 0);
  if (!t) throw new Error('colour transform failed');
  const cmyk = L.cmsDoTransform(t, rgbOf(rgba), rgba.length / 4);
  L.cmsDeleteTransform(t);
  L.cmsCloseProfile(srgb);
  return cmyk.subarray(0, (rgba.length / 4) * 4);
}

/**
 * How the page will look printed: RGB through CMYK and back. With `gamut`, colours
 * that ink cannot reach are painted grey.
 */
export async function proof(imageData, p, { gamut = false, intent = 'perceptual' } = {}) {
  const L = await engine();
  const { consts } = L;
  const srgb = L.cmsCreate_sRGBProfile();
  const out = await profile(p);
  const flags = gamut ? consts.cmsFLAGS_SOFTPROOFING | consts.cmsFLAGS_GAMUTCHECK : consts.cmsFLAGS_SOFTPROOFING;
  const t = L.cmsCreateProofingTransform(srgb, consts.TYPE_RGB_8, srgb, consts.TYPE_RGB_8, out.handle, intentOf(consts, intent), consts.INTENT_RELATIVE_COLORIMETRIC, flags);
  if (!t) throw new Error('colour transform failed');
  const n = imageData.width * imageData.height;
  const rgb = L.cmsDoTransform(t, rgbOf(imageData.data), n);
  L.cmsDeleteTransform(t);
  L.cmsCloseProfile(srgb);
  const res = new ImageData(imageData.width, imageData.height);
  for (let i = 0; i < n; i++) {
    res.data[i * 4] = rgb[i * 3];
    res.data[i * 4 + 1] = rgb[i * 3 + 1];
    res.data[i * 4 + 2] = rgb[i * 3 + 2];
    res.data[i * 4 + 3] = 255;
  }
  return res;
}

function intentOf(c, intent) {
  return intent === 'relative' ? c.INTENT_RELATIVE_COLORIMETRIC : c.INTENT_PERCEPTUAL;
}

/**
 * A print PDF from rendered pages. `pages` is [{ canvas }] at the design size.
 * Each page is one CMYK image; the ICC profile goes in as the output intent.
 */
export async function buildCmykPdf(canvases, { widthPt, heightPt, profileId, title }) {
  const p = PROFILES.find((x) => x.id === profileId) || PROFILES[0];
  const { bytes: icc } = await profile(p);
  const pdf = await PDFDocument.create();
  const ctx = pdf.context;
  for (const cv of canvases) {
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    const cmyk = await toCmyk(data.data, p);
    const stream = ctx.flateStream(cmyk, {
      Type: 'XObject',
      Subtype: 'Image',
      Width: cv.width,
      Height: cv.height,
      ColorSpace: 'DeviceCMYK',
      BitsPerComponent: 8,
    });
    const ref = ctx.register(stream);
    const page = pdf.addPage([widthPt, heightPt]);
    const name = page.node.newXObject('Im', ref);
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(widthPt, 0, 0, heightPt, 0, 0), drawObject(name), popGraphicsState());
  }
  const iccRef = ctx.register(ctx.flateStream(icc, { N: 4 }));
  const intent = ctx.obj({
    Type: 'OutputIntent',
    S: 'GTS_PDFX',
    OutputConditionIdentifier: PDFString.of(p.condition),
    Info: PDFString.of(p.name),
    DestOutputProfile: iccRef,
  });
  pdf.catalog.set(PDFName.of('OutputIntents'), ctx.obj([intent]));
  pdf.setTitle(title);
  return pdf.save();
}
