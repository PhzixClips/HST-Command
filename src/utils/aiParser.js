// Gemini API Smart Fill - parses raw claim data into structured form fields
// API key and model are stored in localStorage via settings

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_MODELS = [
  { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash (Preview)" },
  { id: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro (Preview)" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
  { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  { id: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B" },
];

const SETTINGS_KEY = "hst-settings";

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const SYSTEM_PROMPT = `You are an insurance claims data parser for Kemper/Infinity Insurance High Storage Team.
You receive raw claim notes, IAA/CSAToday data, and vehicle incident information.
Extract and return a JSON object with these exact fields. Return ONLY valid JSON, no markdown fences, no explanation.

{
  "claimNumber": "string - the claim number (e.g. 26123462483)",
  "iaaStock": "string - IAA stock number, an 8-digit number (e.g. 44504032, 44538344)",
  "vehicleYear": "string",
  "vehicleMake": "string",
  "vehicleModel": "string",
  "vin": "string - 17-character vehicle identification number",
  "shopName": "string - shop or tow yard name",
  "shopAlias": "string - any alternate names (aka)",
  "shopAddress": "string - full address",
  "shopPhone": "string",
  "shopLicense": "string - BAR license or valid status",
  "shopEmail": "string",
  "shopCity": "string - city name extracted from address",
  "chargesBilledThrough": "string - MM/DD date charges are billed through",
  "charges": [
    {
      "name": "string - charge type name",
      "amount": "number",
      "rate": "number - daily rate if storage",
      "days": "number - number of days if storage",
      "startDate": "string - MM/DD if storage",
      "endDate": "string - MM/DD if storage",
      "description": "string - optional notes"
    }
  ],
  "fileReview": [
    { "date": "MM/DD", "event": "string - brief event description" }
  ],
  "mitigation": {
    "sentBy": "string - who sent the mitigation/storage cut-off letter",
    "sentByRole": "string - their role (PA, AL, Adjuster, etc.)",
    "sentDate": "string - MM/DD/YYYY",
    "cutOffDate": "string - MM/DD/YYYY",
    "cutOffExplanation": "string - e.g. '3 days post-TL notice on 03/02'"
  },
  "contactPerson": "string - shop contact person name",
  "tlDate": "string - MM/DD/YYYY when vehicle was deemed Total Loss",
  "storageStartDate": "string - MM/DD/YYYY when vehicle arrived at shop",
  "claimReportDate": "string - MM/DD/YYYY when claim was reported to Kemper",
  "adjusterName": "string - claims adjuster name",
  "insuredName": "string - insured/policyholder name",
  "lossDescription": "string - brief description of what happened",
  "appraiserMarketRate": "number - the Fair & Reasonable (F&R) daily storage rate determined by the appraiser's market audit, 0 if not found"
}

CRITICAL EXTRACTION RULES:
- **DATA PRIORITY**: When multiple dated notes exist (e.g. appraiser note from 02/26 and IAA/HST note from 03/03), ALWAYS use the MOST RECENT dated note as the primary source for charges and totals. The most recent note has the final, updated billing. Do NOT use older/earlier charge breakdowns when a newer one exists.
- **Appraiser Market Rate (F&R)**: Search for the appraiser's Fair & Reasonable storage rate. Look for phrases like:
  * "F&R for area is $XXX" or "F&R rate"
  * "DAILY STORAGE RATE AVERAGE" followed by a dollar amount
  * "Fair and Reasonable" or "fair & reasonable" near a daily rate
  * "market rate" or "market audit" with a dollar amount per day
  * Any statement by the appraiser about what the fair/reasonable daily storage rate is
  Return the number (e.g. 250) in the appraiserMarketRate field. If not found, return 0.
- **IAA Stock Number**: This is a critical field. It is an 8-digit numeric ID (e.g. 44504032, 44538344). Look for it in:
  * CSAToday data sections, often labeled "Stock #", "Stock", "IAA Stock", or "IAA#"
  * Near the claim number and vehicle information in header areas
  * In IAA dispatch or pickup references
  * Any 8-digit number that appears alongside claim/vehicle data and is NOT the claim number or VIN
  * NEVER leave this blank if an 8-digit stock number appears anywhere in the data
- **VIN**: A 17-character alphanumeric string. Look in vehicle info sections, CSAToday data, or claim notes.
- **Claim Number**: Usually an 11-digit number starting with 26 (e.g. 26123462483). Found in headers and throughout notes.
- For the file review timeline, extract ALL key events chronologically: DoL, storage start, claim reported, SIU assigned, TL determination, SIU closed, liability decided, mitigation letter sent, high storage handled
- Calculate charge amounts: storage amount = rate * days
- For total billed, include the actual total from the shop invoice
- If a field cannot be determined from the data, use empty string "" or 0
- Return ONLY the JSON object, nothing else

**CHARGES - CRITICAL**: You MUST extract EVERY single line-item charge. Missing even one charge is unacceptable.
  Common charge types found in IAA/CSAToday release notes and shop invoices:
  * Storage (has rate, days, start/end dates)
  * Advance Tow / Towing
  * Tear Down / Teardown
  * Administrative Fee / Admin Fee
  * Extra Equipment
  * Estimate / Estimate Fee
  * Gate Fee
  * Impound Fee
  * Clean Up
  * Dolly
  * Pre-Scan
  * Lien
  * Labor
  **COMBINED LINE ITEMS**: If the shop lumps multiple fees into one line (e.g. "Dolly/Estimate/Cleanup/Yard: $1,000"),
  you MUST split them into SEPARATE charge entries. Each fee type gets its own entry in the charges array.
  If the combined amount can't be split evenly, divide it equally among the sub-items.
  Look for charge breakdowns in ALL of these locations in the data:
  * IAA/CSAToday release notes with "Total Advance Charges Need Approval" sections
  * Lines formatted as "ChargeName: $ amount" or "ChargeName: $amount"
  * Appraiser advance fee notes with "Amount Requested" or "Amount Negotiated" sections
  * Any tabular or listed fee breakdowns
  * The MOST RECENT charge breakdown has the most up-to-date amounts
  Use the exact charge type names listed above (e.g. "Administrative Fee" not "Admin", "Advance Tow" not "Towing").
  For chargesBilledThrough, use the date from the most recent charge breakdown (e.g. "Estimated Pickup Date" or "Billed through" date).`;

/**
 * Deterministic fallback: extract IAA stock number from raw text using regex.
 * IAA stock numbers are 8-digit numbers (starting with 4) that are NOT:
 *   - part of a phone number, zip code, date, claim number, VIN, or policy number
 */
function extractIAAStock(rawText, claimNumber, vin) {
  // First try labeled patterns (highest confidence)
  const labelPatterns = [
    /(?:stock\s*#?|iaa\s*stock|iaa\s*#|iaa#)\s*[:=\-]?\s*(\d{7,9})/gi,
    /(?:stock\s*number)\s*[:=\-]?\s*(\d{7,9})/gi,
  ];
  for (const pat of labelPatterns) {
    const m = pat.exec(rawText);
    if (m) return m[1];
  }

  // Build exclusion set: numbers we know are NOT the stock number
  const excluded = new Set();
  // Claim numbers (10-13 digits but substrings could match)
  if (claimNumber) excluded.add(claimNumber);
  // VIN is alphanumeric so won't match pure digits, but just in case
  if (vin) excluded.add(vin);
  // Extract all phone numbers (10-11 digit sequences, with or without formatting)
  const phones = rawText.match(/\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g) || [];
  phones.forEach(p => excluded.add(p.replace(/\D/g, "")));
  // Policy numbers
  const policyMatch = rawText.match(/(?:pol|policy)\s*[:=\-#]?\s*(\d{8,})/gi);
  if (policyMatch) policyMatch.forEach(p => {
    const n = p.replace(/\D/g, "");
    excluded.add(n);
  });
  // Zip codes (5 digit)
  const zips = rawText.match(/\b\d{5}(?:-\d{4})?\b/g) || [];
  // Appraisal IDs in brackets like [8214444]
  const appraisalIds = rawText.match(/\[(\d{5,9})\]/g) || [];
  appraisalIds.forEach(a => excluded.add(a.replace(/\D/g, "")));

  // Find all 8-digit numbers in the text
  const candidates = [];
  const digitPattern = /\b(\d{8})\b/g;
  let match;
  while ((match = digitPattern.exec(rawText)) !== null) {
    const num = match[1];
    // Skip if it's in our exclusion set or is a substring of a known number
    if (excluded.has(num)) continue;
    // Skip if it looks like a date (MMDDYYYY or YYYYMMDD)
    if (/^(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{4}$/.test(num)) continue;
    if (/^\d{4}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])$/.test(num)) continue;
    // Skip if it's part of a longer number (claim number, phone etc)
    const idx = match.index;
    const before = rawText[idx - 1] || " ";
    const after = rawText[idx + 8] || " ";
    if (/\d/.test(before) || /\d/.test(after)) continue;
    // IAA stock numbers typically start with 4
    if (num.startsWith("4")) {
      candidates.unshift(num); // prioritize 4-prefix
    } else {
      candidates.push(num);
    }
  }

  return candidates.length > 0 ? candidates[0] : "";
}

/**
 * Deterministic fallback: extract claim number from raw text
 */
function extractClaimNumber(rawText) {
  // Kemper claim numbers: 11+ digits, often starting with 26
  const patterns = [
    /(?:claim\s*#?|claim\s*number)\s*[:=\-]?\s*(26\d{9,11})/gi,
    /\b(26\d{9,11})\b/g,
  ];
  for (const pat of patterns) {
    const m = pat.exec(rawText);
    if (m) return m[1];
  }
  return "";
}

/**
 * Deterministic fallback: extract VIN from raw text
 */
function extractVIN(rawText) {
  // VIN is exactly 17 alphanumeric chars (no I, O, Q)
  const vinPattern = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
  const m = vinPattern.exec(rawText);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Deterministic fallback: extract the appraiser's Fair & Reasonable (F&R) daily storage rate.
 * Looks for patterns like "F&R for area is $250", "DAILY STORAGE RATE AVERAGE: $250", etc.
 */
function extractAppraiserRate(rawText) {
  const patterns = [
    /F\s*&\s*R\s+(?:for\s+(?:the\s+)?area\s+is|rate\s*[:=]?)\s*\$\s*([\d,]+\.?\d*)/i,
    /(?:fair\s+(?:&|and)\s+reasonable)\s+(?:rate\s*)?(?:is\s*)?\$\s*([\d,]+\.?\d*)/i,
    /DAILY\s+STORAGE\s+RATE\s+AVERAGE\s*[:=]?\s*\$\s*([\d,]+\.?\d*)/i,
    /(?:market\s+(?:rate|audit))\s*[:=]?\s*\$\s*([\d,]+\.?\d*)\s*(?:\/?\s*day|per\s*day)/i,
    /\$\s*([\d,]+\.?\d*)\s*(?:\/?\s*day|per\s*day)\s*(?:F\s*&\s*R|fair|market)/i,
  ];
  for (const pat of patterns) {
    const m = pat.exec(rawText);
    if (m) {
      const rate = parseFloat(m[1].replace(/,/g, ""));
      if (rate > 0 && rate < 1000) return rate; // sanity check
    }
  }
  return 0;
}

/**
 * Deterministic fallback: extract ALL itemized charges from IAA/CSAToday and shop data.
 * Catches patterns like "Storage: $ 5,250.00", "Advance Tow: $ 940.00", etc.
 * Returns array of { name, amount } objects found in the text.
 */
function extractChargesFromText(rawText) {
  const found = [];

  // Canonical charge names to look for — order matters (longer names first to avoid partial matches)
  const chargeLabels = [
    { pattern: /(?:advance\s*tow|towing|tow\s*(?:fee|bill|charge))\b/i, name: "Advance Tow" },
    { pattern: /\btear\s*down\b/i, name: "Teardown" },
    { pattern: /\b(?:admin(?:istrative)?\s*fee)\b/i, name: "Administrative Fee" },
    { pattern: /\b(?:extra\s*equipment)\b/i, name: "Extra Equipment" },
    { pattern: /\b(?:estimate\s*(?:fee)?)\b(?!\s*(?:amount|repair|supplement))/i, name: "Estimate Fee" },
    { pattern: /\b(?:gate\s*fee)\b/i, name: "Gate Fee" },
    { pattern: /\b(?:impound\s*fee)\b/i, name: "Impound Fee" },
    { pattern: /\b(?:clean\s*up)\b/i, name: "Clean Up" },
    { pattern: /\b(?:dolly)\b/i, name: "Dolly" },
    { pattern: /\b(?:pre[- ]?scan)\b/i, name: "Pre-Scan" },
    { pattern: /\b(?:lien\s*(?:fee)?)\b/i, name: "Lien" },
    { pattern: /\b(?:environmental\s*fee)\b/i, name: "Environmental Fee" },
    { pattern: /\b(?:release\s*fee)\b/i, name: "Release Fee" },
    { pattern: /\b(?:hook\s*up)\b/i, name: "Hook Up" },
    { pattern: /\b(?:yard\s*fee)\b/i, name: "Yard Fee" },
    { pattern: /\b(?:battery\s*maintenance)\b/i, name: "Battery Maintenance" },
    { pattern: /\b(?:cover\s*car)\b/i, name: "Cover Car" },
  ];

  // Match "Label: $ amount" or "Label: $amount" patterns (IAA/CSAToday format)
  // Also match "Label $amount" and "Label = $amount"
  for (const { pattern, name } of chargeLabels) {
    // Build a regex that captures the amount after the label
    const fullPattern = new RegExp(
      pattern.source + "\\s*[:=]?\\s*\\$\\s*([\\d,]+\\.?\\d*)",
      "gi"
    );
    let match;
    const amounts = [];
    while ((match = fullPattern.exec(rawText)) !== null) {
      const amt = parseFloat(match[1].replace(/,/g, ""));
      if (amt > 0) amounts.push(amt);
    }
    // Use the LAST occurrence (most recent/up-to-date charges)
    if (amounts.length > 0) {
      found.push({ name, amount: amounts[amounts.length - 1] });
    }
  }

  // Storage: special handling — extract rate, days, and date range
  const storageRatePattern = /storage\s*rate\s*[:=]?\s*\$\s*([\d,]+\.?\d*)/gi;
  const storageAmtPattern = /(?:^|\n|,)\s*storage\s*[:=]\s*\$\s*([\d,]+\.?\d*)/gi;
  const storageDaysPattern = /storage\s*(?:start|days)?\s*[:=]?\s*(\d{2}\/\d{2}\/\d{4})/gi;

  let storageRate = 0, storageTotal = 0;
  let rateMatches = [], totalMatches = [];

  let m;
  while ((m = storageRatePattern.exec(rawText)) !== null) {
    rateMatches.push(parseFloat(m[1].replace(/,/g, "")));
  }
  while ((m = storageAmtPattern.exec(rawText)) !== null) {
    totalMatches.push(parseFloat(m[1].replace(/,/g, "")));
  }

  if (rateMatches.length > 0) storageRate = rateMatches[rateMatches.length - 1];
  if (totalMatches.length > 0) storageTotal = totalMatches[totalMatches.length - 1];

  // Extract storage start date
  const startPattern = /storage\s*start\s*[:=]?\s*(\d{2}\/\d{2}\/\d{4})/i;
  const startMatch = startPattern.exec(rawText);
  const storageStart = startMatch ? startMatch[1] : "";

  // Extract estimated pickup / billed-through date
  const pickupPattern = /(?:estimated\s*pickup\s*date|billed\s*through)\s*[:=]?\s*(\d{2}\/\d{2}\/\d{4})/i;
  const pickupMatch = pickupPattern.exec(rawText);
  const billedThrough = pickupMatch ? pickupMatch[1] : "";

  if (storageTotal > 0 || storageRate > 0) {
    const days = storageRate > 0 && storageTotal > 0 ? Math.round(storageTotal / storageRate) : 0;
    const startMmdd = storageStart ? storageStart.substring(0, 5) : "";
    const endMmdd = billedThrough ? billedThrough.substring(0, 5) : "";
    found.unshift({
      name: "Storage",
      amount: storageTotal,
      rate: storageRate,
      days,
      startDate: startMmdd,
      endDate: endMmdd,
    });
  }

  return { charges: found, billedThrough: billedThrough ? billedThrough.substring(0, 5) : "" };
}

/**
 * Split combined charge names like "Dolly/Estimate/Cleanup/Yard" into individual charges.
 * Divides the total amount equally among sub-items.
 */
function splitCombinedCharges(charges) {
  const result = [];
  const knownNames = [
    "storage", "advance tow", "towing", "teardown", "tear down",
    "administrative fee", "admin fee", "extra equipment",
    "estimate fee", "estimate", "gate fee", "impound fee",
    "clean up", "cleanup", "dolly", "pre-scan", "lien",
    "labor", "environmental fee", "release fee", "hook up",
    "yard fee", "yard", "battery maintenance", "cover car",
  ];

  for (const charge of charges) {
    const name = charge.name || "";
    // Check if the name contains "/" or "&" separating multiple charge types
    if (/[\/&]/.test(name) && name.length > 20) {
      const parts = name.split(/[\/&,]+/).map(p => p.trim()).filter(Boolean);
      // Only split if we recognize at least 2 of the parts as known charge names
      const recognized = parts.filter(p =>
        knownNames.some(kn => p.toLowerCase().includes(kn) || kn.includes(p.toLowerCase()))
      );
      if (recognized.length >= 2) {
        const splitAmt = (charge.amount || 0) / parts.length;
        for (const part of parts) {
          // Normalize the part name to a canonical charge name
          const canonical = knownNames.find(kn =>
            part.toLowerCase().includes(kn) || kn.includes(part.toLowerCase())
          );
          const displayName = canonical
            ? canonical.split(" ").map(w => w[0].toUpperCase() + w.slice(1)).join(" ")
            : part;
          result.push({ ...charge, name: displayName, amount: Math.round(splitAmt * 100) / 100 });
        }
        continue;
      }
    }
    result.push(charge);
  }
  return result;
}

/**
 * Merge regex-extracted charges into AI-parsed charges.
 * Only adds charges that the AI missed (by name match).
 * If AI got an amount wrong vs regex, keep the AI amount (user can review).
 */
function mergeCharges(aiCharges, regexResult) {
  const merged = [...(aiCharges || [])];
  const existingNames = new Set(merged.map(c => c.name.toLowerCase().trim()));

  for (const rc of regexResult.charges) {
    const rcLower = rc.name.toLowerCase().trim();
    // Check if AI already captured this charge (fuzzy match)
    const alreadyExists = existingNames.has(rcLower) ||
      [...existingNames].some(existing => {
        const normExisting = existing.replace(/\s+/g, "");
        const normNew = rcLower.replace(/\s+/g, "");
        return normExisting.includes(normNew) || normNew.includes(normExisting);
      });

    if (!alreadyExists) {
      merged.push(rc);
    }
  }

  return merged;
}

/**
 * Post-process AI result: fill in any blanks the AI missed using regex fallbacks
 */
function postProcess(parsed, rawText) {
  // Fallback for claim number
  if (!parsed.claimNumber) {
    parsed.claimNumber = extractClaimNumber(rawText);
  }
  // Fallback for VIN
  if (!parsed.vin) {
    parsed.vin = extractVIN(rawText);
  }
  // Fallback for IAA stock - ALWAYS run this if AI left it blank
  if (!parsed.iaaStock) {
    parsed.iaaStock = extractIAAStock(rawText, parsed.claimNumber, parsed.vin);
  }
  // Split any combined charge lines (e.g. "Dolly/Estimate/Cleanup/Yard") into individual charges
  parsed.charges = splitCombinedCharges(parsed.charges || []);
  // ALWAYS run charge extraction and merge — we can't afford to miss any charges
  const regexResult = extractChargesFromText(rawText);
  parsed.charges = mergeCharges(parsed.charges, regexResult);
  // Fill in billed-through date if AI missed it
  if (!parsed.chargesBilledThrough && regexResult.billedThrough) {
    parsed.chargesBilledThrough = regexResult.billedThrough;
  }
  // Fallback for appraiser F&R rate
  if (!parsed.appraiserMarketRate || parsed.appraiserMarketRate === 0) {
    parsed.appraiserMarketRate = extractAppraiserRate(rawText);
  }
  return parsed;
}

// ── Simple hash for cache key ──────────────────────────────────
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

// ── In-memory + sessionStorage parse cache ─────────────────────
const parseCache = new Map();
const CACHE_STORAGE_KEY = "hst-parse-cache";

function getCachedResult(rawText) {
  const key = simpleHash(rawText.trim());
  // Check in-memory first
  if (parseCache.has(key)) return parseCache.get(key);
  // Check sessionStorage
  try {
    const stored = JSON.parse(sessionStorage.getItem(CACHE_STORAGE_KEY) || "{}");
    if (stored[key]) {
      parseCache.set(key, stored[key]);
      return stored[key];
    }
  } catch {}
  return null;
}

function setCachedResult(rawText, result) {
  const key = simpleHash(rawText.trim());
  parseCache.set(key, result);
  try {
    const stored = JSON.parse(sessionStorage.getItem(CACHE_STORAGE_KEY) || "{}");
    // Keep cache bounded — only store last 10 results
    const keys = Object.keys(stored);
    if (keys.length >= 10) delete stored[keys[0]];
    stored[key] = result;
    sessionStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(stored));
  } catch {}
}

export async function parseClaimData(rawText) {
  // Check cache first — exact same paste = instant result, zero API cost
  const cached = getCachedResult(rawText);
  if (cached) {
    console.log("[HST] Cache hit — skipping API call");
    return cached;
  }

  const settings = getSettings();
  const key = settings.apiKey || import.meta.env.VITE_GEMINI_KEY;
  const model = settings.model || "gemini-2.0-flash";

  if (!key) throw new Error("No API key configured. Go to Settings to add your Gemini API key.");

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${key}`;

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `Parse the following claim data and extract all fields:\n\n${rawText}` }] }],
    generationConfig: {
      maxOutputTokens: 8000,
      temperature: 0.1,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }

  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Clean up: remove markdown fences if present
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Run deterministic fallbacks for critical fields the AI often misses
    const result = postProcess(parsed, rawText);
    setCachedResult(rawText, result);
    return result;
  } catch (e) {
    console.error("Failed to parse AI response:", cleaned);
    throw new Error("AI returned invalid data. Please try again or fill the form manually.");
  }
}
