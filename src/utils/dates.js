// Date formatting and business day calculations

export function formatMMDD(dateStr) {
  if (!dateStr) return "";
  const d = parseDate(dateStr);
  if (!d || isNaN(d.getTime())) return dateStr;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export function formatMMDDYYYY(dateStr) {
  if (!dateStr) return "";
  const d = parseDate(dateStr);
  if (!d || isNaN(d.getTime())) return dateStr;
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export function parseDate(str) {
  if (!str) return null;
  if (str instanceof Date) return str;
  // Handle MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD
  const s = str.trim();
  let m;
  if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/))) {
    return new Date(+m[3], +m[1] - 1, +m[2]);
  }
  if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/))) {
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  if (!start || !end) return 0;
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

export function addBusinessDays(dateStr, numDays) {
  const d = parseDate(dateStr);
  if (!d) return "";
  let added = 0;
  const result = new Date(d);
  while (added < numDays) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return formatMMDDYYYY(result);
}

export function toInputDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d || isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fromInputDate(isoStr) {
  if (!isoStr) return "";
  const [y, m, d] = isoStr.split("-");
  return `${m}/${d}/${y}`;
}

// Normalize MM/DD to MM/DD/YYYY by inferring year from a reference date string
export function normalizeDateWithYear(dateStr, refDateStr) {
  if (!dateStr) return dateStr;
  const s = dateStr.trim();
  // Already has year — return as-is
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) return s;
  if (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/.test(s)) return s;
  // MM/DD format — add year from reference date
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (m) {
    const ref = parseDate(refDateStr);
    const year = ref ? ref.getFullYear() : new Date().getFullYear();
    return `${m[1]}/${m[2]}/${year}`;
  }
  return dateStr;
}
