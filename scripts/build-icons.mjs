// Builds src/icon-data.json from the Lucide icons (ISC) and a set of brand
// logos from Simple Icons (CC0). Run with: node scripts/build-icons.mjs
import fs from 'fs';

const dir = 'node_modules/lucide-static/icons';
const tags = JSON.parse(fs.readFileSync('node_modules/lucide-static/tags.json', 'utf8'));
const icons = [];
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith('.svg')) continue;
  const n = f.slice(0, -4);
  const svg = fs.readFileSync(`${dir}/${f}`, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
  icons.push({ n, t: (tags[n] || []).join(' '), s: inner });
}

const BRANDS = ['instagram', 'facebook', 'messenger', 'whatsapp', 'tiktok', 'youtube', 'x', 'threads', 'linkedin', 'viber', 'telegram', 'line', 'wechat', 'pinterest', 'snapchat', 'spotify', 'gmail', 'googlemaps', 'shopee', 'lazada', 'grab', 'foodpanda', 'paypal', 'visa', 'mastercard', 'applepay', 'googlepay', 'zalo', 'discord', 'reddit', 'twitch', 'kakaotalk'];
const brands = [];
const si = JSON.parse(fs.readFileSync('node_modules/simple-icons/data/simple-icons.json', 'utf8'));
const list = Array.isArray(si) ? si : si.icons;
for (const slug of BRANDS) {
  const file = `node_modules/simple-icons/icons/${slug}.svg`;
  if (!fs.existsSync(file)) {
    console.log('missing', slug);
    continue;
  }
  const svg = fs.readFileSync(file, 'utf8');
  const d = svg.match(/<path d="([^"]+)"/)[1];
  const meta = list.find((i) => (i.slug || i.title.toLowerCase().replace(/[^a-z0-9]/g, '')) === slug) || {};
  brands.push({ n: meta.title || slug, slug, hex: meta.hex ? `#${meta.hex}` : '#101c2b', d });
}
fs.writeFileSync('src/icon-data.json', JSON.stringify({ icons, brands }));
console.log(icons.length, 'icons', brands.length, 'brands', fs.statSync('src/icon-data.json').size, 'bytes');
