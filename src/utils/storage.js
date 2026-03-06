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
  } catch (e) {
    console.error("localStorage write failed:", e);
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
  safeSet(KEYS.TEMPLATES, templates);
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
