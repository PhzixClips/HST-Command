// Reads the user's master sheet (same column order as the "Fill to master sheet" row)
// and turns it into savings, shop history, and aging stats.
// A: Claim#, B: Date, C: CV/IV, D: Carrier, E: Shop Name, F: Status, G: Open/Closed,
// H: Billed, I: Approved, J: Disputed, K: Total Approved, L: IAA Stock#,
// M: Completion Date, N: Days

const STORE_KEY = "hst-master-import";
const DAY = 86400000;

// ── Parsing helpers ────────────────────────────────────────────
function toMoney(v) {
  if (typeof v === "number") return v;
  if (v == null) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = parseFloat(s.replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
}

function toDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === "number") {
    // Excel serial date
    if (v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * DAY));
    return null;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    if (y < 100) y += 2000;
    const d = new Date(y, parseInt(m[1]) - 1, parseInt(m[2]));
    return isNaN(d) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const iso = d => (d ? d.toISOString().slice(0, 10) : null);

export function normalizeShop(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|corp|co|company|the|ltd)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowFromCells(c) {
  const claim = String(c[0] ?? "").replace(/\s/g, "");
  if (!/\d{5,}/.test(claim)) return null; // skips header and blank rows
  const billed = toMoney(c[7]);
  if (billed == null) return null;
  const approved = toMoney(c[8]);
  const totalApproved = toMoney(c[10]) ?? approved;
  const status = String(c[5] ?? "").trim();
  const openClosed = String(c[6] ?? "").trim();
  // The app writes "NEGOTIATION COMPLETED" for in-progress claims too, so trust
  // column G first and only fall back to status when a completion date exists.
  const closed = /closed/i.test(openClosed) || (/completed/i.test(status) && !!toDate(c[12]));
  const opened = toDate(c[1]);
  const completed = toDate(c[12]);
  const daysCell = toMoney(c[13]);
  return {
    claim,
    opened: iso(opened),
    coverage: String(c[2] ?? "").trim(),
    carrier: String(c[3] ?? "").trim(),
    shop: String(c[4] ?? "").trim(),
    status,
    closed,
    billed,
    approved: totalApproved ?? 0,
    saved: Math.max(0, billed - (totalApproved ?? billed)),
    completed: iso(completed),
    days: daysCell ?? (opened && completed ? Math.max(0, Math.round((completed - opened) / DAY)) : null),
  };
}

// Reads every sheet in the workbook (the app's own export names sheets by year).
export async function parseMasterSheet(file) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const byClaim = new Map();
  let scanned = 0;
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    for (const cells of rows) {
      scanned++;
      const r = rowFromCells(cells);
      if (r) byClaim.set(r.claim, r); // later rows win
    }
  }
  const rows = [...byClaim.values()];
  if (rows.length === 0) {
    throw new Error("Couldn't find any claim rows. The app expects claim # in column A and Billed in column H, like the master sheet row it copies.");
  }
  const data = { fileName: file.name, importedAt: new Date().toISOString(), rows, scanned };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch { throw new Error("The sheet is too big to store in the browser."); }
  return data;
}

export function getMasterImport() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch { return null; }
}

export function clearMasterImport() {
  try { localStorage.removeItem(STORE_KEY); } catch {}
}

// ── Stats ──────────────────────────────────────────────────────
function summarize(rows) {
  const billed = rows.reduce((s, r) => s + r.billed, 0);
  const approved = rows.reduce((s, r) => s + r.approved, 0);
  const saved = rows.reduce((s, r) => s + r.saved, 0);
  const dayRows = rows.filter(r => r.days != null);
  return {
    count: rows.length,
    billed, approved, saved,
    reduction: billed > 0 ? Math.round((saved / billed) * 100) : 0,
    avgDays: dayRows.length ? Math.round(dayRows.reduce((s, r) => s + r.days, 0) / dayRows.length) : null,
  };
}

const monthKey = r => (r.completed || r.opened || "").slice(0, 7);

export function computeScoreboard(rows, now = new Date()) {
  const closed = rows.filter(r => r.closed);
  const open = rows.filter(r => !r.closed);
  const thisYear = String(now.getFullYear());
  const thisMonth = now.toISOString().slice(0, 7);

  const months = new Map();
  for (const r of closed) {
    const k = monthKey(r);
    if (!k) continue;
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(r);
  }
  const monthly = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([month, rs]) => ({ month, ...summarize(rs) }));

  const shops = new Map();
  for (const r of closed) {
    const k = normalizeShop(r.shop);
    if (!k) continue;
    if (!shops.has(k)) shops.set(k, { name: r.shop, rows: [] });
    shops.get(k).rows.push(r);
  }
  const topShops = [...shops.values()]
    .map(s => ({ name: s.name, ...summarize(s.rows) }))
    .sort((a, b) => b.saved - a.saved)
    .slice(0, 8);

  const today = now.getTime();
  const aging = open
    .map(r => ({ ...r, age: r.opened ? Math.max(0, Math.round((today - new Date(r.opened).getTime()) / DAY)) : null }))
    .sort((a, b) => (b.age ?? -1) - (a.age ?? -1));

  return {
    allTime: summarize(closed),
    year: summarize(closed.filter(r => monthKey(r).startsWith(thisYear))),
    month: summarize(closed.filter(r => monthKey(r) === thisMonth)),
    monthly,
    topShops,
    aging,
    openCount: open.length,
    openBilled: open.reduce((s, r) => s + r.billed, 0),
  };
}

// History for one shop, for use while working a claim.
export function getShopHistoryFromMaster(shopName) {
  const data = getMasterImport();
  const key = normalizeShop(shopName);
  if (!data || key.length < 3) return null;
  const rows = data.rows.filter(r => r.closed && normalizeShop(r.shop) === key);
  if (rows.length === 0) return null;
  const recent = [...rows].sort((a, b) => (b.completed || "").localeCompare(a.completed || "")).slice(0, 5);
  return { ...summarize(rows), recent };
}
