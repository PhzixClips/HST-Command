// Deterministic shop offer email builder
// Matches adjuster's real email format exactly
import { fmt, fmtDollar } from "./calculations.js";
import { CHARGE_TYPES, isChargeDenied, getDefaultAmount } from "../data/chargeTypes.js";

// ── Subject line generator ──────────────────────────────────────
export function generateSubjectLine(d) {
  const claim = d.claimNumber || "";
  const vehicle = [d.vehicleYear, (d.vehicleMake || "").toUpperCase(), (d.vehicleModel || "").toUpperCase()].filter(Boolean).join(" ");
  const vin = d.vin || "";
  const parts = [`Claim ${claim}`];
  if (vehicle) parts.push(vehicle);
  if (vin) parts.push(`VIN: ${vin}`);
  return parts.join(" | ");
}

// ── Build itemized charge lines from form charges ──
function buildChargeLines(charges, prefix = "") {
  const lines = [];
  let total = 0;
  for (const c of (charges || [])) {
    if (!c.name) continue;
    const amt = parseFloat(c.amount) || 0;
    total += amt;
    const lower = c.name.toLowerCase();
    if (lower === "storage" && c.rate && c.days) {
      lines.push(`${prefix}Storage Rate: $${fmt(c.rate)} X${c.days} DAYS`);
    } else {
      lines.push(`${prefix}${c.name}: ${fmtDollar(amt)}`);
    }
  }
  lines.push(`${prefix}Total: ${fmtDollar(total)}`);
  return { lines, total };
}

// ── Build negotiation lines from audit data + charges ──
function buildNegotiationLines(d, prefix = "") {
  const lines = [];
  const audit = d.audit || {};
  const charges = d.charges || [];
  let total = 0;

  for (const c of charges) {
    if (!c.name) continue;
    const lower = c.name.toLowerCase();

    if (lower === "storage") {
      const rate = parseFloat(audit.approvedStorageRate) || 0;
      const days = parseInt(audit.approvedStorageDays) || parseInt(c.days) || 0;
      const amt = rate * days;
      total += amt;
      lines.push(`${prefix}Storage Rate: $${fmt(rate)} X${days} DAYS`);
    } else if (lower.includes("tow") || lower === "advance tow") {
      const amt = parseFloat(audit.approvedTow) || 0;
      total += amt;
      lines.push(`${prefix}Advance Tow: ${fmtDollar(amt)}`);
    } else if (lower === "teardown") {
      const amt = parseFloat(audit.approvedTeardown) || 0;
      total += amt;
      lines.push(`${prefix}Teardown: ${fmtDollar(amt)}`);
    } else if (lower === "labor") {
      const amt = parseFloat(audit.approvedLabor) || 0;
      total += amt;
      lines.push(`${prefix}Labor: ${fmtDollar(amt)}`);
    } else if (isChargeDenied(c.name)) {
      lines.push(`${prefix}${c.name}: $0.00`);
    } else {
      // Approved charges (Dolly, Clean Up, Pre-Scan, Lien, etc.)
      const ct = CHARGE_TYPES.find(ct => ct.name.toLowerCase() === lower);
      let amt = 0;
      if (ct?.approveAsBilled) {
        amt = parseFloat(c.amount) || 0;
      } else if (ct?.defaultAmount) {
        amt = ct.defaultAmount;
      } else {
        amt = parseFloat(c.amount) || 0;
      }
      total += amt;
      lines.push(`${prefix}${c.name}: ${fmtDollar(amt)}`);
    }
  }
  lines.push(`${prefix}Total: ${fmtDollar(total)}`);
  return { lines, total };
}

// ── Tone variations ─────────────────────────────────────────────
const TONE = {
  firm: {
    greeting: () => `Hello,`,
    closing: `Please let us know if this can be done, or if you would like to charge other fees to insured allow me to speak to them on deductions.`,
    signoff: `Thank you so much for your time and help we look forward to working with you today :)`,
  },
  friendly: {
    greeting: (person) => person ? `Hey ${person},` : `Hi there,`,
    closing: `Please let us know if this works for you! If you have any questions at all don't hesitate to reach out — I'm happy to chat :)`,
    signoff: `Thanks so much for your time and help! :)`,
  },
  final: {
    greeting: () => `Hello,`,
    closing: `This is our final offer on this claim. Please let us know if you'd like to accept so we can get IAA out there and get payment processed for you as soon as possible. If you would like to charge other fees to insured allow me to speak to them on deductions.`,
    signoff: `Thank you,`,
  },
};

// ── Main email generator ────────────────────────────────────────
export function generateShopEmail(d, tone = "firm", selectedCitations = []) {
  const T = TONE[tone] || TONE.firm;
  const lines = [];
  const audit = d.audit || {};
  const contact = d.contact || {};
  const person = contact.contactPerson || "";

  // Greeting
  lines.push(T.greeting(person));
  lines.push("");

  // Intro
  lines.push("I have been assigned to review charges, collect documents for proof of claim, and approve the money with Kemper for IAA to come make their pickup for this vehicle.");

  // Shop's requested charges
  lines.push("At this time we understand the shop is requesting;");
  const shopCharges = buildChargeLines(d.charges || []);
  lines.push(...shopCharges.lines);
  lines.push("");

  // Negotiation request intro
  lines.push("I would like to request a negotiation based on what Kemper insurance can cover for the customer under their insuring agreement.");
  lines.push("");
  lines.push("NEGOTIATION REQUEST:");
  const negCharges = buildNegotiationLines(d);
  lines.push(...negCharges.lines);
  lines.push("");
  lines.push("");

  // Pickup line
  const today = new Date();
  const dateStr = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;
  lines.push(`At this time, we would like to pick up the vehicle for the customer for the above requested ${fmtDollar(negCharges.total)}`);
  lines.push(`today ${dateStr} with no deductions to our customer.`);
  lines.push("");
  lines.push("");

  // Disclaimer
  lines.push("Please keep in mind, the repair facility invoices their customer. Kemper reviews the invoice and determine what is owed under the insuring agreement and all applicable Consumer Protection Laws in CA.");
  lines.push("");
  lines.push("");

  // Closing
  lines.push(T.closing);
  lines.push("");

  // Legal citations (if any selected)
  if (selectedCitations && selectedCitations.length > 0) {
    lines.push("");
    lines.push("__  __");
    for (const citation of selectedCitations) {
      // Replace {cutoffDate} placeholder with actual cutoff date if available
      let text = citation.text || "";
      const cutoff = d.mitigation?.cutOffDate || dateStr;
      text = text.replace("{cutoffDate}", cutoff);
      lines.push("");
      lines.push(text);
    }
    lines.push("");
  }

  // Sign-off
  lines.push("__  __");
  lines.push(T.signoff);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
