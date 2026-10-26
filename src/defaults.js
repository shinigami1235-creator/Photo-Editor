// Defaults Gid saves with the Save as default buttons: Touch up, Before and
// after, label and tag looks, and the Quick fixes amounts. New files and
// Claude's batch jobs start from these.

import { dataReadJson, dataWriteJson } from './platform.js';

const FILE = 'settings/defaults.json';

export const FACTORY = {
  touchUp: { fixes: ['slimFace'], amount: 40, sideBySide: true, layout: 'side', labels: ['Today', 'Goal'] },
  beforeAfter: { layout: 'side', labels: ['Before', 'After'], align: true },
  labels: { show: true, opacity: 0, size: 100, fill: '#101c2b', color: '#ffffff' },
  tag: { text: 'Simulated goal', size: 100, fill: '#e0b45a', color: '#101c2b' },
  // Amounts the Quick fixes buttons apply, by amount name (smooth, slimFace...).
  quickFix: {},
};

let saved = {};

export async function loadDefaults() {
  saved = (await dataReadJson(FILE, {})) || {};
  return saved;
}

/** A copy of one section: the factory values with Gid's saved ones on top. */
export function defaults(section) {
  return structuredClone({ ...FACTORY[section], ...(saved[section] || {}) });
}

export async function saveDefaults(section, values) {
  saved = { ...saved, [section]: { ...(saved[section] || {}), ...values } };
  await dataWriteJson(FILE, saved);
}
