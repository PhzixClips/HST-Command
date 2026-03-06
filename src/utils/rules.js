// Business rules: AB-2392 compliance, mitigation window, market rate defaults
import { addBusinessDays, daysBetween, parseDate } from "./dates.js";
import { isChargeDenied } from "../data/chargeTypes.js";

// AB-2392: Determine which charges are approved vs denied
export function applyAB2392(charges) {
  return charges.map(charge => ({
    ...charge,
    autoDenied: isChargeDenied(charge.name),
  }));
}

// Build the denied fees summary string
export function getDeniedFeesSummary(charges) {
  const denied = charges.filter(c => isChargeDenied(c.name) && c.amount > 0);
  if (denied.length === 0) return "";
  const names = denied.map(c => c.name);
  return names.join(", ");
}

// Calculate mitigation cut-off date: TL date + 3 business days
export function calcMitigationCutoff(tlDate) {
  if (!tlDate) return "";
  return addBusinessDays(tlDate, 3);
}

// Determine storage coverage start date
// Normal: arrival date
// Late notification: date of notice to carrier (if vehicle arrived before claim filed)
export function getStorageCoverageStart(arrivalDate, claimReportDate) {
  if (!arrivalDate || !claimReportDate) return arrivalDate || "";
  const arrival = parseDate(arrivalDate);
  const report = parseDate(claimReportDate);
  if (!arrival || !report) return arrivalDate;
  const daysDiff = daysBetween(arrivalDate, claimReportDate);
  // If vehicle was at shop for more than 3 days before claim was filed,
  // storage starts at notification date
  if (daysDiff > 3) {
    return claimReportDate;
  }
  return arrivalDate;
}

// Check if there's a late notification warning
export function isLateNotification(arrivalDate, claimReportDate) {
  if (!arrivalDate || !claimReportDate) return false;
  return daysBetween(arrivalDate, claimReportDate) > 3;
}

// Default market rates by area
const MARKET_DEFAULTS = {
  "los angeles": 250,
  "la": 250,
  "compton": 250,
  "gardena": 250,
  "long beach": 250,
  "inglewood": 250,
  "hawthorne": 250,
  "torrance": 250,
  "carson": 250,
  "wilmington": 250,
  "south gate": 250,
  "lynwood": 250,
  "paramount": 250,
  "bellflower": 250,
  "downey": 250,
  "norwalk": 250,
  "whittier": 250,
  "pomona": 225,
  "riverside": 200,
  "san bernardino": 200,
  "san diego": 225,
  "san francisco": 275,
  "sacramento": 200,
  "fresno": 175,
  "bakersfield": 175,
  "_default_ca": 250,
};

export function getDefaultMarketRate(city, state) {
  if (!state || state.toUpperCase() !== "CA") return 150;
  if (!city) return MARKET_DEFAULTS["_default_ca"];
  const lower = city.toLowerCase().trim();
  return MARKET_DEFAULTS[lower] || MARKET_DEFAULTS["_default_ca"];
}

// Look up rate from imported rate database
export function lookupShopRate(shopName, rateDatabase) {
  if (!shopName || !rateDatabase || rateDatabase.length === 0) return null;
  const lower = shopName.toLowerCase();
  const exact = rateDatabase.find(r => r.shopName.toLowerCase() === lower);
  if (exact) return exact;
  const partial = rateDatabase.find(r =>
    lower.includes(r.shopName.toLowerCase()) ||
    r.shopName.toLowerCase().includes(lower)
  );
  return partial || null;
}
