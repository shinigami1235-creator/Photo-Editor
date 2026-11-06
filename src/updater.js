// Updates without the .bat files. A little after Photo Editor opens, and every
// few hours, it asks the newest GitHub release whether there is a newer
// version. If there is, it downloads it quietly and shows "Update ready" in the
// top bar. Clicking that installs it and reopens Photo Editor; otherwise it
// installs when Photo Editor closes. Every update is checked against the
// signing key in tauri.conf.json before it runs.

import { isDesktop } from './platform.js';
import { h, modal, toast } from './ui.js';

let pending = null;
let checking = null;
let badge = null;
let keepWork = async () => true;

/** This app's version, such as 0.4.21. */
export async function appVersion() {
  if (!isDesktop) return 'browser preview';
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '?';
  }
}

/** badgeEl is the hidden Update ready button; save() keeps the open design safe before a restart. */
export function startUpdater(badgeEl, save) {
  badge = badgeEl;
  keepWork = save;
  badge.addEventListener('click', () => offerInstall());
  if (!isDesktop) return;
  setTimeout(() => checkForUpdate({ quiet: true }), 20000);
  setInterval(() => checkForUpdate({ quiet: true }), 4 * 3600 * 1000);
}

/** Looks for a newer version and downloads it. quiet: say nothing unless one is ready. */
export async function checkForUpdate({ quiet = false } = {}) {
  if (!isDesktop) return quiet ? null : toast('Updates work in the installed Photo Editor.');
  if (pending) return quiet ? null : offerInstall();
  if (checking) return checking;
  checking = (async () => {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const upd = await check({ timeout: 30000 });
      if (!upd) {
        if (!quiet) toast(`This is the newest version (${await appVersion()}).`);
        return;
      }
      if (!quiet) toast(`Downloading version ${upd.version}`);
      await upd.download();
      pending = upd;
      badge.hidden = false;
      badge.title = `Version ${upd.version} is downloaded. Click to install it now, or it installs when you close Photo Editor.`;
      if (!quiet) offerInstall();
    } catch (e) {
      if (!quiet) toast(`Could not check for updates: ${e?.message || e}`, { error: true });
    } finally {
      checking = null;
    }
  })();
  return checking;
}

async function offerInstall() {
  if (!pending) return;
  const v = pending.version;
  const go = await modal('Update ready', h('p', {}, `Version ${v} is downloaded. Installing closes Photo Editor for a few seconds and opens it again. A design with unsaved changes comes back through Restore design.`), [
    { label: 'Later', value: false },
    { label: 'Install now', value: true, primary: true },
  ]);
  if (!go) return;
  await installNow();
}

async function installNow() {
  await keepWork();
  toast(`Installing version ${pending.version}`, { sticky: true });
  try {
    await pending.install();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    toast(`The update did not install: ${e?.message || e}`, { error: true });
  }
}

/** For closing, after the design was saved or let go: installs a downloaded update. Returns false when there is none. */
export async function installOnClose() {
  if (!pending) return false;
  try {
    await pending.install();
    return true;
  } catch {
    return false;
  }
}
