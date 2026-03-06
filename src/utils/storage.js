// localStorage CRUD helpers for templates, rates, and settings

const KEYS = {
  TEMPLATES: "hst-templates",
  RATES: "hst-shop-rates",
  SETTINGS: "hst-settings",
};

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error("localStorage write failed:", e);
    return false;
  }
}

// Templates
export function getTemplates() {
  return safeGet(KEYS.TEMPLATES, []);
}

export function saveTemplate(template) {
  const templates = getTemplates();
  const idx = templates.findIndex(t => t.id === template.id);
  if (idx >= 0) {
    templates[idx] = { ...template, updatedAt: new Date().toISOString() };
  } else {
    templates.unshift({
      ...template,
      id: template.id || crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
  const ok = safeSet(KEYS.TEMPLATES, templates);
  if (!ok) throw new Error("Save failed — localStorage may be full. Export your data as a backup.");
  return templates;
}

export function deleteTemplate(id) {
  const templates = getTemplates().filter(t => t.id !== id);
  safeSet(KEYS.TEMPLATES, templates);
  return templates;
}

// Shop Rates
export function getRates() {
  return safeGet(KEYS.RATES, []);
}

export function saveRates(rates) {
  safeSet(KEYS.RATES, rates);
}

export function addRates(newRates) {
  const existing = getRates();
  // Merge: update existing by shop name, add new ones
  const merged = [...existing];
  for (const nr of newRates) {
    const idx = merged.findIndex(
      r => r.shopName.toLowerCase() === nr.shopName.toLowerCase()
    );
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...nr, importedAt: new Date().toISOString() };
    } else {
      merged.push({ ...nr, importedAt: new Date().toISOString() });
    }
  }
  safeSet(KEYS.RATES, merged);
  return merged;
}

export function deleteRate(shopName) {
  const rates = getRates().filter(
    r => r.shopName.toLowerCase() !== shopName.toLowerCase()
  );
  safeSet(KEYS.RATES, rates);
  return rates;
}

// Shop Contact Log
const CONTACTS_KEY = "hst-shop-contacts";

export function getShopContacts() {
  return safeGet(CONTACTS_KEY, []);
}

export function addShopContact(entry) {
  const log = getShopContacts();
  log.unshift({
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
  safeSet(CONTACTS_KEY, log);
  return log;
}

export function getShopContactsByName(shopName) {
  if (!shopName) return [];
  const log = getShopContacts();
  return log.filter(e => e.shopName.toLowerCase() === shopName.toLowerCase());
}

export function deleteShopContact(id) {
  const log = getShopContacts().filter(e => e.id !== id);
  safeSet(CONTACTS_KEY, log);
  return log;
}

// Shop Reputation — calculate stats from completed claims
export function getShopReputation(shopName) {
  if (!shopName) return null;
  const templates = getTemplates();
  const lower = shopName.toLowerCase();
  const shopClaims = templates.filter(t =>
    (t.shopName || "").toLowerCase() === lower && t.resolution?.approvedCharges > 0
  );
  if (shopClaims.length === 0) return null;

  let totalBilled = 0;
  let totalApproved = 0;
  for (const t of shopClaims) {
    const billed = (t.charges || []).reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    const approved = t.resolution?.approvedCharges || 0;
    totalBilled += billed;
    totalApproved += approved;
  }
  const totalSaved = Math.max(0, totalBilled - totalApproved);
  const avgReduction = totalBilled > 0 ? ((totalSaved / totalBilled) * 100) : 0;

  return {
    claimCount: shopClaims.length,
    totalBilled,
    totalApproved,
    totalSaved,
    avgReduction: Math.round(avgReduction),
  };
}

// ── Data Export / Import ───────────────────────────────────────
export function exportAllData() {
  const data = {
    _hstBackup: true,
    _exportedAt: new Date().toISOString(),
    templates: safeGet(KEYS.TEMPLATES, []),
    rates: safeGet(KEYS.RATES, []),
    settings: safeGet(KEYS.SETTINGS, {}),
    contacts: safeGet("hst-shop-contacts", []),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hst-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importAllData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data._hstBackup) {
          reject(new Error("Not a valid HST backup file."));
          return;
        }
        let count = 0;
        if (data.templates) { safeSet(KEYS.TEMPLATES, data.templates); count += data.templates.length; }
        if (data.rates) { safeSet(KEYS.RATES, data.rates); }
        if (data.settings) { safeSet(KEYS.SETTINGS, data.settings); }
        if (data.contacts) { safeSet("hst-shop-contacts", data.contacts); }
        resolve({ claimCount: count, exportedAt: data._exportedAt });
      } catch (e) {
        reject(new Error("Invalid backup file: " + e.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}
