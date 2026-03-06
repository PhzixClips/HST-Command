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
  "lossDescription": "string - brief description of what happened"
}

CRITICAL EXTRACTION RULES:
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
- Return ONLY the JSON object, nothing else`;

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
  return parsed;
}

export async function parseClaimData(rawText) {
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
    return postProcess(parsed, rawText);
  } catch (e) {
    console.error("Failed to parse AI response:", cleaned);
    throw new Error("AI returned invalid data. Please try again or fill the form manually.");
  }
}
