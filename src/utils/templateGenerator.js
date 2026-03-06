// Deterministic internal template builder
// Produces the exact format used in claim notes
import { fmt, fmtDollar } from "./calculations.js";

export function generateTemplate(d) {
  const lines = [];

  // Header
  const shopUpper = (d.shopName || "").toUpperCase();
  lines.push(`${shopUpper}*** HIGH STORAGE NEGOTIATION REVIEW/CLOSING TEMPLATE ***`);
  lines.push(d.claimNumber || "");
  lines.push(`IAA Stock: ${d.iaaStock || ""}`);
  lines.push(`IV-${d.vehicleYear || ""} ${(d.vehicleMake || "").toUpperCase()} ${(d.vehicleModel || "").toUpperCase()}`);
  lines.push(`VIN: ${d.vin || ""}`);

  // Shop Info
  lines.push("");
  const alias = d.shopAlias ? ` (aka ${d.shopAlias})` : "";
  lines.push(`SHOP/TOW YARD: ${d.shopName || ""}${alias}`);
  lines.push(`ADDRESS: ${d.shopAddress || ""}`);
  lines.push(`PHONE: ${d.shopPhone || ""}`);
  lines.push(`LICENSE: ${d.shopLicense || ""}`);
  lines.push(`EMAIL: ${d.shopEmail || ""}`);

  // Shop Charges
  lines.push("");
  lines.push(`SHOP CHARGES (Billed through ${d.chargesBilledThrough || ""}):`);
  const charges = d.charges || [];
  for (const c of charges) {
    if (!c.name) continue;
    const lower = c.name.toLowerCase();
    if (lower === "storage" && c.rate && c.days) {
      lines.push(`Storage: ${fmtDollar(c.amount)} @ $${fmt(c.rate)}/day x ${c.days} days (${c.startDate || ""} \u2013 ${c.endDate || ""})`);
    } else {
      const desc = c.description ? ` ${c.description}` : "";
      lines.push(`${c.name}: ${fmtDollar(c.amount)}${desc}`);
    }
  }
  const totalBilled = charges.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  lines.push(`Total Billed: ${fmtDollar(totalBilled)}`);

  // File Review
  lines.push("");
  lines.push("FILE REVIEW:");
  const review = d.fileReview || [];
  for (const entry of review) {
    if (entry.date || entry.event) {
      lines.push(`${entry.date || ""} ${entry.event || ""}`);
    }
  }

  // Mitigation
  lines.push("");
  lines.push("STORAGE CUT-OFF LTR SENT (MIT LTR):");
  const mit = d.mitigation || {};
  const roleStr = mit.sentByRole ? ` (${mit.sentByRole})` : "";
  lines.push(`Sent By: ${mit.sentBy || ""}${roleStr}`);
  lines.push(`On Date: ${mit.sentDate || ""}`);
  const cutExpl = mit.cutOffExplanation ? ` (${mit.cutOffExplanation})` : "";
  lines.push(`Cut Off: ${mit.cutOffDate || ""}${cutExpl}`);

  // Kemper Coverage
  lines.push("");
  lines.push("KEMPER WILL COVER (HST/MARKET AUDIT):");
  const audit = d.audit || {};
  const storageAmt = (parseFloat(audit.approvedStorageRate) || 0) * (parseInt(audit.approvedStorageDays) || 0);
  const storageDateRange = `${audit.storageStartDate || ""} \u2013 ${audit.storageEndDate || ""}`;
  lines.push(`Storage: ${fmtDollar(storageAmt)} (${audit.approvedStorageDays || 0} days @ $${fmt(audit.approvedStorageRate)}/day - Market Max Audit: ${storageDateRange})`);
  lines.push(`Advance Tow: ${fmtDollar(audit.approvedTow)} (${audit.towNote || "Approved as billed"})`);

  if (parseFloat(audit.approvedTeardown) > 0) {
    lines.push(`Teardown: ${fmtDollar(audit.approvedTeardown)} (${audit.teardownNote || "Adjusted per appraiser\u2019s verified labor audit"})`);
  }
  if (parseFloat(audit.approvedLabor) > 0) {
    lines.push(`Labor: ${fmtDollar(audit.approvedLabor)} (${audit.laborNote || "Authorized per verified shop labor request"})`);
  }

  // Approved other charges (dolly, cleanup, pre-scan, lien, extra equipment, etc.)
  if (parseFloat(audit.approvedOther) > 0) {
    lines.push(`Other Approved: ${fmtDollar(audit.approvedOther)} (${audit.otherNote || "See breakdown"})`);
  }

  // Denied fees
  const deniedNames = (audit.deniedFees || []).filter(Boolean);
  if (deniedNames.length > 0) {
    lines.push(`Denied Fees: $0.00 (${deniedNames.join(", ")} ${audit.deniedFeesReason || "— standard business overhead per AB-2392"})`);
  }

  const totalApproved = storageAmt +
    (parseFloat(audit.approvedTow) || 0) +
    (parseFloat(audit.approvedTeardown) || 0) +
    (parseFloat(audit.approvedLabor) || 0) +
    (parseFloat(audit.approvedOther) || 0);
  lines.push(`Total Allowable (Pre-Tax): ${fmtDollar(totalApproved)}`);
  lines.push(`Total Approved (Incl. Tax): ${fmtDollar(totalApproved)}`);

  // Contact to Shop
  lines.push("");
  lines.push("CONTACT TO SHOP:");
  const contact = d.contact || {};
  if (contact.narrative) {
    lines.push(contact.narrative);
  }

  // Resolution
  lines.push("");
  const res = d.resolution || {};
  const dispatchAmt = parseFloat(res.dispatchAmount) || totalApproved;
  lines.push("RESOLUTION:");
  lines.push(`Dispatch IAA for ${fmtDollar(dispatchAmt)}`);
  lines.push(`__dispatch IAA for ${fmtDollar(dispatchAmt)}`);
  lines.push("__deductions apply.");
  lines.push(`***Approved charges on CSA today @ ${res.csaTime || ""}***`);
  lines.push(`Approved Charges: ${fmtDollar(res.approvedCharges || totalApproved)}`);
  lines.push(`Disputed Charges: ${fmtDollar(res.disputedCharges || totalBilled)}`);
  const reductions = Math.max(0, totalBilled - totalApproved);
  lines.push(`Reductions: ${fmtDollar(res.reductions || reductions)}`);
  lines.push(`Deduction: ${fmtDollar(res.deduction || 0)}`);
  lines.push("");
  lines.push(`CUSTOMER NOTIFIED: ${res.customerNotified || "y"}`);
  lines.push(`DENIAL LETTER SENT AND ATTACHED TO FILE: ${res.denialLetterSent || "n/a"}`);
  lines.push(`VEHICLE LOCATION: IAA STOCK\u2013${d.iaaStock || ""}`);
  lines.push(`OWNER/COMPANY RETAINED: ${res.ownerRetained || "COMPANY"}`);
  lines.push(`COMMENTS: ******${res.comments || ""}******`);

  return lines.join("\n");
}

// Generate the auto-narrative for "Contact to Shop" section
// Written to sound like a real person, not a corporate template
export function generateContactNarrative(d) {
  const audit = d.audit || {};
  const storageAmt = (parseFloat(audit.approvedStorageRate) || 0) * (parseInt(audit.approvedStorageDays) || 0);
  const totalApproved = storageAmt +
    (parseFloat(audit.approvedTow) || 0) +
    (parseFloat(audit.approvedTeardown) || 0) +
    (parseFloat(audit.approvedLabor) || 0) +
    (parseFloat(audit.approvedOther) || 0);

  const contact = d.contact || {};
  const person = contact.contactPerson || "[contact person]";
  const shopName = d.shopName || "[shop name]";
  const deniedNames = (audit.deniedFees || []).filter(Boolean);

  let narrative = `Spoke with ${person} at ${shopName} about the payment. `;
  narrative += `Let them know we can cover ${fmtDollar(totalApproved)} total. `;
  narrative += `Went over the rate — adjusted it to $${fmt(audit.approvedStorageRate)}/day based on what other shops in the ${d.shopCity || ""} area are charging. `;
  narrative += `Storage is covered from arrival ${audit.storageEndDate ? `through the mitigation cutoff` : "through today"}. `;

  if (parseFloat(audit.approvedTow) > 0) {
    narrative += `Tow is ${audit.towNote || "good as billed"}. `;
  }
  if (parseFloat(audit.approvedTeardown) > 0) {
    narrative += `Teardown got adjusted to match standard labor for what was done. `;
  }
  if (parseFloat(audit.approvedLabor) > 0) {
    narrative += `Labor is approved. `;
  }
  if (parseFloat(audit.approvedOther) > 0) {
    narrative += `${audit.otherNote || "Other charges"} approved. `;
  }
  if (deniedNames.length > 0) {
    narrative += `Had to deny ${deniedNames.join(", ").toLowerCase()} — those fall under business overhead per AB-2392. `;
  }
  narrative += `Once they accept, IAA is good to go for pickup.`;

  return narrative;
}
