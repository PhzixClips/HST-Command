// Automatic backups.
// Preferred: a folder the user picks once (Chrome/Edge). One file per day,
// rewritten through the day, newest 7 kept.
// Fallback (other browsers): a backup file downloaded once a week.
// The Gemini API key is never written to backup files.

const DB_NAME = "hst-backup";
const STORE = "handles";
const HANDLE_KEY = "folder";
const LAST_KEY = "hst-last-backup";
const LAST_DOWNLOAD_KEY = "hst-last-backup-download";
const KEEP_DAYS = 7;
const PREFIX = "hst-backup-";

export const folderBackupSupported = typeof window !== "undefined" && "showDirectoryPicker" in window;

// ── IndexedDB (folder handles can't live in localStorage) ──────
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const getHandle = () => idb("readonly", s => s.get(HANDLE_KEY)).catch(() => null);
const setHandle = h => idb("readwrite", s => s.put(h, HANDLE_KEY));
const clearHandle = () => idb("readwrite", s => s.delete(HANDLE_KEY));

// ── Backup contents ────────────────────────────────────────────
function read(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}

export function buildBackup() {
  const { apiKey, ...settings } = read("hst-settings", {});
  return {
    _hstBackup: true,
    _exportedAt: new Date().toISOString(),
    templates: read("hst-templates", []),
    rates: read("hst-shop-rates", []),
    settings,
    contacts: read("hst-shop-contacts", []),
    masterImport: read("hst-master-import", null),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export function getLastBackup() {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

function markBackedUp() {
  try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch {}
}

// ── Status ─────────────────────────────────────────────────────
// "off" | "active" | "needs-permission" | "fallback"
export async function getBackupStatus() {
  if (!folderBackupSupported) return { state: "fallback", folder: null };
  const handle = await getHandle();
  if (!handle) return { state: "off", folder: null };
  const perm = await handle.queryPermission({ mode: "readwrite" }).catch(() => "denied");
  return { state: perm === "granted" ? "active" : "needs-permission", folder: handle.name };
}

// ── Writing ────────────────────────────────────────────────────
async function writeToFolder(handle) {
  const file = await handle.getFileHandle(`${PREFIX}${today()}.json`, { create: true });
  const writable = await file.createWritable();
  await writable.write(JSON.stringify(buildBackup(), null, 2));
  await writable.close();
  markBackedUp();

  // Keep only the newest KEEP_DAYS daily files
  const names = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "file" && name.startsWith(PREFIX) && name.endsWith(".json")) names.push(name);
  }
  names.sort().reverse();
  for (const old of names.slice(KEEP_DAYS)) {
    await handle.removeEntry(old).catch(() => {});
  }
}

function downloadBackup() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${PREFIX}${today()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markBackedUp();
  try { localStorage.setItem(LAST_DOWNLOAD_KEY, new Date().toISOString()); } catch {}
}

// Runs silently in the background. Never prompts.
export async function runAutoBackup() {
  try {
    if (!folderBackupSupported) {
      const last = localStorage.getItem(LAST_DOWNLOAD_KEY);
      const weekMs = 7 * 24 * 60 * 60 * 1000;
      const hasData = read("hst-templates", []).length > 0;
      if (hasData && (!last || Date.now() - new Date(last).getTime() > weekMs)) downloadBackup();
      return;
    }
    const handle = await getHandle();
    if (!handle) return;
    if ((await handle.queryPermission({ mode: "readwrite" })) !== "granted") return;
    await writeToFolder(handle);
  } catch (e) {
    console.warn("Auto-backup failed:", e);
  }
}

// ── User actions (must be called from a click) ─────────────────
export async function chooseBackupFolder() {
  const handle = await window.showDirectoryPicker({ id: "hst-backups", mode: "readwrite" });
  await setHandle(handle);
  await writeToFolder(handle);
  return handle.name;
}

export async function resumeBackups() {
  const handle = await getHandle();
  if (!handle) return false;
  const perm = await handle.requestPermission({ mode: "readwrite" });
  if (perm !== "granted") return false;
  await writeToFolder(handle);
  return true;
}

export async function stopBackups() {
  await clearHandle();
}

// Returns the newest backup File from the chosen folder, or null.
export async function getLatestBackupFile() {
  const handle = await getHandle();
  if (!handle) return null;
  if ((await handle.requestPermission({ mode: "readwrite" })) !== "granted") return null;
  let newest = null;
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === "file" && name.startsWith(PREFIX) && name.endsWith(".json")) {
      if (!newest || name > newest.name) newest = { name, entry };
    }
  }
  return newest ? newest.entry.getFile() : null;
}
