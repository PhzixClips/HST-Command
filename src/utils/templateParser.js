// Parse a pasted claim template (the format produced by templateGenerator.js)
// back into structured form fields so the dashboard can be updated.

/**
 * Parse a pasted template string and extract form-compatible fields.
 * Handles the exact format from generateTemplate() as well as hand-edited variations.
 * Returns an object with only the fields that were successfully extracted.
 */
export function parseTemplate(text) {
  if (!text || !text.trim()) return null;
  const lines = text.split("\n").map(l => l.trim());
  const result = {};

  // ── Header fields ─────────────────────────────────────────
  // Line 0: "SHOPNAME*** HIGH STORAGE NEGOTIATION REVIEW/CLOSING TEMPLATE ***"
  const headerLine = lines.find(l => /HIGH STORAGE NEGOTIATION/i.test(l));
  if (headerLine) {
    const shopMatch = headerLine.match(/^(.+?)\*{3}/);
    if (shopMatch) result.shopName = shopMatch[1].trim();
  }

  // Claim number: standalone line that looks like 26XXXXXXXXX
  const claimLine = lines.find(l => /^26\d{8,11}$/.test(l));
  if (claimLine) result.claimNumber = claimLine.trim();

  // IAA Stock
  const iaaLine = lines.find(l => /^IAA\s*Stock\s*:/i.test(l));
  if (iaaLine) result.iaaStock = iaaLine.replace(/^IAA\s*Stock\s*:\s*/i, "").trim();

  // Vehicle info: "IV-YYYY MAKE MODEL"
  const vehLine = lines.find(l => /^IV-\d{4}/i.test(l));
  if (vehLine) {
    const vm = vehLine.match(/^IV-(\d{4})\s+(\S+)\s+(.*)/i);
    if (vm) {
      result.vehicleYear = vm[1];
      result.vehicleMake = vm[2];
      result.vehicleModel = vm[3].trim();
    }
  }

  // VIN
  const vinLine = lines.find(l => /^VIN\s*:/i.test(l));
  if (vinLine) result.vin = vinLine.replace(/^VIN\s*:\s*/i, "").trim();

  // ── Shop Info ─────────────────────────────────────────────
  const shopField = (label) => {
    const line = lines.find(l => new RegExp(`^${label}\\s*:`, "i").test(l));
    return line ? line.replace(new RegExp(`^${label}\\s*:\\s*`, "i"), "").trim() : "";
  };

  const shopTowLine = lines.find(l => /^SHOP\/TOW YARD\s*:/i.test(l));
  if (shopTowLine) {
    const raw = shopTowLine.replace(/^SHOP\/TOW YARD\s*:\s*/i, "").trim();
    const aliasMatch = raw.match(/^(.+?)\s*\(aka\s+(.+)\)\s*$/i);
    if (aliasMatch) {
      if (!result.shopName) result.shopName = aliasMatch[1].trim();
      result.shopAlias = aliasMatch[2].trim();
    } else {
      if (!result.shopName) result.shopName = raw;
    }
  }

  const addr = shopField("ADDRESS");
  if (addr) result.shopAddress = addr;
  const phone = shopField("PHONE");
  if (phone) result.shopPhone = phone;
  const license = shopField("LICENSE");
  if (license) result.shopLicense = license;
  const email = shopField("EMAIL");
  if (email) result.shopEmail = email;

  // ── Shop Charges ──────────────────────────────────────────
  const chargesHeaderIdx = lines.findIndex(l => /^SHOP CHARGES/i.test(l));
  if (chargesHeaderIdx >= 0) {
    // Extract billed through date
    const btMatch = lines[chargesHeaderIdx].match(/Billed through\s+(\S+)/i);
    if (btMatch) result.chargesBilledThrough = btMatch[1];

    const charges = [];
    for (let i = chargesHeaderIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || /^(FILE REVIEW|STORAGE CUT-OFF|KEMPER|CONTACT|RESOLUTION)/i.test(line)) break;
      if (/^Total Billed/i.test(line)) continue;

      // Storage line: "Storage: $5,250.00 @ $175.00/day x 30 days (01/15 – 02/14)"
      const storageMatch = line.match(
        /^Storage\s*:\s*\$\s*([\d,]+\.?\d*)\s*@\s*\$\s*([\d,]+\.?\d*)\/day\s*x\s*(\d+)\s*days?\s*\((\S+)\s*[–\-]\s*(\S+)\)/i
      );
      if (storageMatch) {
        charges.push({
          id: crypto.randomUUID(),
          name: "Storage",
          amount: parseFloat(storageMatch[1].replace(/,/g, "")),
          rate: parseFloat(storageMatch[2].replace(/,/g, "")),
          days: parseInt(storageMatch[3]),
          startDate: storageMatch[4],
          endDate: storageMatch[5],
          description: "",
          autoDenied: false,
        });
        continue;
      }

      // Generic charge: "ChargeName: $123.45 optional description"
      const chargeMatch = line.match(/^(.+?):\s*\$\s*([\d,]+\.?\d*)\s*(.*)?$/);
      if (chargeMatch) {
        charges.push({
          id: crypto.randomUUID(),
          name: chargeMatch[1].trim(),
          amount: parseFloat(chargeMatch[2].replace(/,/g, "")),
          rate: 0,
          days: 0,
          startDate: "",
          endDate: "",
          description: (chargeMatch[3] || "").trim(),
          autoDenied: false,
        });
      }
    }
    if (charges.length > 0) result.charges = charges;
  }

  // ── File Review ───────────────────────────────────────────
  const frIdx = lines.findIndex(l => /^FILE REVIEW\s*:/i.test(l));
  if (frIdx >= 0) {
    const events = [];
    for (let i = frIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || /^(STORAGE CUT-OFF|KEMPER|CONTACT|RESOLUTION|SHOP CHARGES)/i.test(line)) break;
      // "MM/DD event description"
      const evMatch = line.match(/^(\d{1,2}\/\d{1,2})\s+(.+)/);
      if (evMatch) {
        events.push({ date: evMatch[1], event: evMatch[2] });
      }
    }
    if (events.length > 0) result.fileReview = events;
  }

  // ── Mitigation ────────────────────────────────────────────
  const mitIdx = lines.findIndex(l => /^STORAGE CUT-OFF/i.test(l));
  if (mitIdx >= 0) {
    const mitigation = {};
    for (let i = mitIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || /^(KEMPER|CONTACT|RESOLUTION|FILE REVIEW|SHOP CHARGES)/i.test(line)) break;
      const sentByMatch = line.match(/^Sent By\s*:\s*(.+?)(?:\s*\((.+)\))?\s*$/i);
      if (sentByMatch) {
        mitigation.sentBy = sentByMatch[1].trim();
        if (sentByMatch[2]) mitigation.sentByRole = sentByMatch[2].trim();
      }
      const onDateMatch = line.match(/^On Date\s*:\s*(.+)/i);
      if (onDateMatch) mitigation.sentDate = onDateMatch[1].trim();
      const cutMatch = line.match(/^Cut Off\s*:\s*(.+?)(?:\s*\((.+)\))?\s*$/i);
      if (cutMatch) {
        mitigation.cutOffDate = cutMatch[1].trim();
        if (cutMatch[2]) mitigation.cutOffExplanation = cutMatch[2].trim();
      }
    }
    if (Object.keys(mitigation).length > 0) result.mitigation = mitigation;
  }

  // ── Audit (KEMPER WILL COVER) ─────────────────────────────
  const auditIdx = lines.findIndex(l => /^KEMPER WILL COVER/i.test(l));
  if (auditIdx >= 0) {
    const audit = {};
    for (let i = auditIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || /^(CONTACT TO SHOP|RESOLUTION|FILE REVIEW|SHOP CHARGES|STORAGE CUT-OFF)/i.test(line)) break;

      // Storage: $3,500.00 (20 days @ $175.00/day - Market Max Audit: 01/15 – 02/04)
      const storageAuditMatch = line.match(
        /^Storage\s*:\s*\$\s*([\d,]+\.?\d*)\s*\((\d+)\s*days?\s*@\s*\$\s*([\d,]+\.?\d*)\/day\s*.*?:\s*(\S+)\s*[–\-]\s*(\S+)\)/i
      );
      if (storageAuditMatch) {
        audit.approvedStorageAmount = parseFloat(storageAuditMatch[1].replace(/,/g, ""));
        audit.approvedStorageDays = parseInt(storageAuditMatch[2]);
        audit.approvedStorageRate = parseFloat(storageAuditMatch[3].replace(/,/g, ""));
        audit.storageStartDate = storageAuditMatch[4];
        audit.storageEndDate = storageAuditMatch[5];
        continue;
      }

      // Advance Tow: $940.00 (Approved as billed)
      const towMatch = line.match(/^Advance Tow\s*:\s*\$\s*([\d,]+\.?\d*)(?:\s*\((.+)\))?/i);
      if (towMatch) {
        audit.approvedTow = parseFloat(towMatch[1].replace(/,/g, ""));
        if (towMatch[2]) audit.towNote = towMatch[2].trim();
        continue;
      }

      // Teardown
      const tdMatch = line.match(/^Teardown\s*:\s*\$\s*([\d,]+\.?\d*)(?:\s*\((.+)\))?/i);
      if (tdMatch) {
        audit.approvedTeardown = parseFloat(tdMatch[1].replace(/,/g, ""));
        if (tdMatch[2]) audit.teardownNote = tdMatch[2].trim();
        continue;
      }

      // Labor
      const labMatch = line.match(/^Labor\s*:\s*\$\s*([\d,]+\.?\d*)(?:\s*\((.+)\))?/i);
      if (labMatch) {
        audit.approvedLabor = parseFloat(labMatch[1].replace(/,/g, ""));
        if (labMatch[2]) audit.laborNote = labMatch[2].trim();
        continue;
      }

      // Other Approved
      const otherMatch = line.match(/^Other Approved\s*:\s*\$\s*([\d,]+\.?\d*)(?:\s*\((.+)\))?/i);
      if (otherMatch) {
        audit.approvedOther = parseFloat(otherMatch[1].replace(/,/g, ""));
        if (otherMatch[2]) audit.otherNote = otherMatch[2].trim();
        continue;
      }

      // Denied Fees
      const deniedMatch = line.match(/^Denied Fees\s*:\s*\$[\d,.]+ \((.+?)(?:\s*[–\-—]\s*.+)?\)/i);
      if (deniedMatch) {
        audit.deniedFees = deniedMatch[1].split(",").map(s => s.trim()).filter(Boolean);
        continue;
      }

      // Total Allowable / Total Approved - skip (calculated)
    }
    if (Object.keys(audit).length > 0) result.audit = audit;
  }

  // ── Contact Narrative ─────────────────────────────────────
  const contactIdx = lines.findIndex(l => /^CONTACT TO SHOP\s*:/i.test(l));
  if (contactIdx >= 0) {
    const narrativeLines = [];
    for (let i = contactIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^(RESOLUTION|FILE REVIEW|SHOP CHARGES|STORAGE CUT-OFF|KEMPER)/i.test(line)) break;
      if (line) narrativeLines.push(line);
    }
    if (narrativeLines.length > 0) {
      result.contact = { narrative: narrativeLines.join("\n") };
    }
  }

  // ── Resolution ────────────────────────────────────────────
  const resIdx = lines.findIndex(l => /^RESOLUTION\s*:/i.test(l));
  if (resIdx >= 0) {
    const resolution = {};
    for (let i = resIdx + 1; i < lines.length; i++) {
      const line = lines[i];

      const csaMatch = line.match(/Approved charges on CSA today @\s*(.+)\*{3}/i);
      if (csaMatch) resolution.csaTime = csaMatch[1].trim();

      const acMatch = line.match(/^Approved Charges\s*:\s*\$\s*([\d,]+\.?\d*)/i);
      if (acMatch) resolution.approvedCharges = parseFloat(acMatch[1].replace(/,/g, ""));

      const dcMatch = line.match(/^Disputed Charges\s*:\s*\$\s*([\d,]+\.?\d*)/i);
      if (dcMatch) resolution.disputedCharges = parseFloat(dcMatch[1].replace(/,/g, ""));

      const redMatch = line.match(/^Reductions\s*:\s*\$\s*([\d,]+\.?\d*)/i);
      if (redMatch) resolution.reductions = parseFloat(redMatch[1].replace(/,/g, ""));

      const dedMatch = line.match(/^Deduction\s*:\s*\$\s*([\d,]+\.?\d*)/i);
      if (dedMatch) resolution.deduction = parseFloat(dedMatch[1].replace(/,/g, ""));

      const dispMatch = line.match(/^Dispatch IAA for\s*\$\s*([\d,]+\.?\d*)/i);
      if (dispMatch) resolution.dispatchAmount = parseFloat(dispMatch[1].replace(/,/g, ""));

      const custMatch = line.match(/^CUSTOMER NOTIFIED\s*:\s*(.+)/i);
      if (custMatch) resolution.customerNotified = custMatch[1].trim();

      const denLetterMatch = line.match(/^DENIAL LETTER SENT.*:\s*(.+)/i);
      if (denLetterMatch) resolution.denialLetterSent = denLetterMatch[1].trim();

      const ownerMatch = line.match(/^OWNER\/COMPANY RETAINED\s*:\s*(.+)/i);
      if (ownerMatch) resolution.ownerRetained = ownerMatch[1].trim();

      const commMatch = line.match(/^COMMENTS\s*:\s*\*{6}(.*?)\*{6}/i);
      if (commMatch) resolution.comments = commMatch[1].trim();
    }
    if (Object.keys(resolution).length > 0) result.resolution = resolution;
  }

  return Object.keys(result).length > 0 ? result : null;
}
