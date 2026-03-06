import React, { useState, useEffect, useCallback, useRef } from "react";
import { T, inputStyle, labelStyle, btnStyle } from "./theme.js";
import { generateTemplate, generateContactNarrative } from "./utils/templateGenerator.js";
import { generateShopEmail, generateSubjectLine, generatePendingDocsEmail, generatePendingDocsSubject, PENDING_DOC_TYPES } from "./utils/emailGenerator.js";
import { parseClaimData, GEMINI_MODELS, getSettings, saveSettings } from "./utils/aiParser.js";
import { CHARGE_TYPES, isChargeDenied, getDefaultAmount } from "./data/chargeTypes.js";
import { LEGAL_CITATIONS } from "./data/legalCitations.js";
import { calcMitigationCutoff, getDefaultMarketRate, lookupShopRate, isLateNotification, getDeniedFeesSummary } from "./utils/rules.js";
import { daysBetween, formatMMDD, formatMMDDYYYY, toInputDate, fromInputDate, addBusinessDays } from "./utils/dates.js";
import { calcTotalBilled, calcApprovedStorage, calcTotalApproved, calcDisputed, fmt, fmtDollar } from "./utils/calculations.js";
import { getTemplates, saveTemplate, deleteTemplate, getRates, saveRates, addRates, deleteRate, addShopContact, getShopContactsByName, deleteShopContact, getShopReputation } from "./utils/storage.js";
import { DEFAULT_SHOPS } from "./data/defaultShops.js";

// ─── Motivational quotes ───────────────────────────────────────
const QUOTES = [
  "Success is not final, failure is not fatal — it is the courage to continue that counts.",
  "The only way to do great work is to love what you do.",
  "Don't watch the clock; do what it does. Keep going.",
  "Every accomplishment starts with the decision to try.",
  "You are never too old to set another goal or to dream a new dream.",
  "Believe you can and you're halfway there.",
  "It does not matter how slowly you go as long as you do not stop.",
  "The secret of getting ahead is getting started.",
  "Hard work beats talent when talent doesn't work hard.",
  "Difficult roads often lead to beautiful destinations.",
  "Your limitation — it's only your imagination.",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Dream it. Wish it. Do it.",
  "Stay focused and never give up.",
  "Little things make big days.",
  "It's going to be hard, but hard does not mean impossible.",
  "The difference between ordinary and extraordinary is that little extra.",
  "Don't stop when you're tired. Stop when you're done.",
  "Wake up with determination. Go to bed with satisfaction.",
];

// ─── Claim statuses ────────────────────────────────────────────
const CLAIM_STATUSES = [
  { key: "pending", label: "Pending", color: "#d4a040" },
  { key: "negotiating", label: "Negotiating", color: "#6b8afd" },
  { key: "escalated", label: "Escalated", color: "#e05555" },
  { key: "completed", label: "Completed", color: "#4ade80" },
];

// ─── Empty template factory ────────────────────────────────────
function createEmpty() {
  return {
    id: "",
    claimNumber: "",
    iaaStock: "",
    vehicleYear: "",
    vehicleMake: "",
    vehicleModel: "",
    vin: "",
    shopName: "",
    shopAlias: "",
    shopAddress: "",
    shopCity: "",
    shopPhone: "",
    shopLicense: "",
    shopEmail: "",
    chargesBilledThrough: "",
    charges: [{ id: crypto.randomUUID(), name: "Storage", amount: 0, rate: 0, days: 0, startDate: "", endDate: "", description: "", autoDenied: false }],
    fileReview: [{ date: "", event: "" }],
    mitigation: { sentBy: "", sentByRole: "", sentDate: "", cutOffDate: "", cutOffExplanation: "" },
    audit: {
      approvedStorageRate: 0, approvedStorageDays: 0, approvedStorageAmount: 0,
      storageStartDate: "", storageEndDate: "",
      approvedTow: 0, towNote: "",
      approvedTeardown: 0, teardownNote: "",
      approvedLabor: 0, laborNote: "",
      approvedOther: 0, otherNote: "",
      deniedFees: [], deniedFeesReason: "are standard business overhead per AB-2392",
    },
    contact: { contactPerson: "", narrative: "" },
    resolution: {
      dispatchAmount: 0, csaTime: "", approvedCharges: 0, disputedCharges: 0,
      reductions: 0, deduction: 0, customerNotified: "y", denialLetterSent: "n/a",
      ownerRetained: "COMPANY", comments: "",
    },
    insuredName: "", adjusterName: "", lossDescription: "",
    tlDate: "", storageStartDate: "", claimReportDate: "",
    rawPastedData: "",
    pendingDocs: [],
    followUpAt: null,
    followUpNote: "",
    status: "pending",
  };
}

// ─── Shared UI primitives ──────────────────────────────────────
function Input({ label, value, onChange, type = "text", placeholder = "", style: sx = {}, small = false }) {
  return (
    <div style={{ flex: 1, minWidth: small ? 80 : 120, ...sx }}>
      {label && <label style={labelStyle}>{label}</label>}
      <input
        type={type}
        value={value ?? ""}
        onChange={e => onChange(type === "number" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle, fontSize: small ? 11 : 12, padding: small ? "5px 8px" : "8px 10px" }}
      />
    </div>
  );
}

function TextArea({ label, value, onChange, rows = 4, placeholder = "" }) {
  return (
    <div style={{ width: "100%" }}>
      {label && <label style={labelStyle}>{label}</label>}
      <textarea
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
      />
    </div>
  );
}

function Btn({ children, onClick, color = T.green, small = false, disabled = false, style: sx = {} }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...btnStyle(color, small), opacity: disabled ? 0.4 : 1, ...sx }}
    >
      {children}
    </button>
  );
}

function Section({ title, accent = T.green, defaultOpen = true, badge = null, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${accent}22`, borderRadius: 6, marginBottom: 10, background: T.cardBg }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", cursor: "pointer", userSelect: "none",
          borderBottom: open ? `1px solid ${accent}15` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 14, background: accent, borderRadius: 2 }} />
          <span style={{ color: accent, fontSize: 11, fontWeight: 700, letterSpacing: 2, fontFamily: T.font }}>{title}</span>
          {badge && <span style={{ background: `${T.amber}22`, color: T.amber, fontSize: 8, padding: "2px 6px", borderRadius: 3, fontFamily: T.font, letterSpacing: 1 }}>{badge}</span>}
        </div>
        <span style={{ color: T.textDim, fontSize: 14 }}>{open ? "\u25B4" : "\u25BE"}</span>
      </div>
      {open && <div style={{ padding: "12px 14px" }}>{children}</div>}
    </div>
  );
}

function Row({ children, gap = 10 }) {
  return <div style={{ display: "flex", gap, marginBottom: 8, flexWrap: "wrap" }}>{children}</div>;
}

// ─── Paste Panel ───────────────────────────────────────────────
function PastePanel({ onParsed, storedRaw = "" }) {
  const [raw, setRaw] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [peekOpen, setPeekOpen] = useState(false);

  const handleSmartFill = async () => {
    if (!raw.trim()) return;
    setParsing(true);
    setError("");
    try {
      const parsed = await parseClaimData(raw);
      onParsed(parsed, raw);
      setCollapsed(true);
    } catch (e) {
      setError(e.message);
    }
    setParsing(false);
  };

  // Use storedRaw (from form state) as the peek content; fall back to current textarea
  const peekText = storedRaw || raw;

  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, background: T.cardBg, marginBottom: 16 }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 3, height: 14, background: T.accent, borderRadius: 2 }} />
          <span style={{ color: T.text, fontSize: 11, fontWeight: 600, letterSpacing: 1.5, fontFamily: T.font }}>PASTE RAW DATA</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {peekText && collapsed && (
            <span
              onClick={e => { e.stopPropagation(); setPeekOpen(!peekOpen); }}
              style={{
                color: peekOpen ? T.amber : T.textDim,
                fontSize: 9,
                fontFamily: T.font,
                letterSpacing: 1,
                cursor: "pointer",
                padding: "3px 8px",
                borderRadius: 3,
                border: `1px solid ${peekOpen ? T.amber + "55" : T.textDim + "33"}`,
                background: peekOpen ? T.amber + "15" : "transparent",
                transition: "all 0.2s",
              }}
            >
              {peekOpen ? "HIDE NOTES" : "VIEW NOTES"}
            </span>
          )}
          <span style={{ color: T.textDim, fontSize: 14 }}>{collapsed ? "\u25BE" : "\u25B4"}</span>
        </div>
      </div>
      {/* Peek viewer - read-only overlay of raw notes */}
      {collapsed && peekOpen && peekText && (
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{
            background: T.inputBg,
            border: `1px solid ${T.border}`,
            borderRadius: 6,
            padding: 12,
            maxHeight: 400,
            overflowY: "auto",
            fontSize: 11,
            fontFamily: T.mono,
            color: T.textDim,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            userSelect: "text",
          }}>
            {peekText}
          </div>
        </div>
      )}
      {!collapsed && (
        <div style={{ padding: "0 14px 14px" }}>
          <textarea
            value={raw}
            onChange={e => setRaw(e.target.value)}
            placeholder="Paste all raw claim data here... (claim notes, IAA/CSAToday data, vehicle incident info)"
            rows={12}
            style={{
              ...inputStyle,
              fontFamily: T.mono,
              width: "100%",
              resize: "vertical",
              lineHeight: 1.5,
              color: T.text,
              fontSize: 11,
            }}
          />
          <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
            <Btn onClick={handleSmartFill} color={T.amber} disabled={!raw.trim() || parsing}>
              {parsing ? "PARSING..." : "SMART FILL"}
            </Btn>
            <Btn onClick={() => { setRaw(""); setError(""); }} color={T.textDim} small>CLEAR</Btn>
            {error && <span style={{ color: T.red, fontSize: 11, fontFamily: T.font }}>{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Charges Section ───────────────────────────────────────────
function ChargesEditor({ charges, onChange, billedThrough, onBilledThroughChange }) {
  const add = () => {
    onChange([...charges, { id: crypto.randomUUID(), name: "", amount: 0, rate: 0, days: 0, startDate: "", endDate: "", description: "", autoDenied: false }]);
  };
  const remove = (id) => onChange(charges.filter(c => c.id !== id));
  const update = (id, field, val) => {
    onChange(charges.map(c => {
      if (c.id !== id) return c;
      const updated = { ...c, [field]: val };
      // Auto-calc storage amount
      if (field === "rate" || field === "days") {
        updated.amount = (parseFloat(updated.rate) || 0) * (parseInt(updated.days) || 0);
      }
      // Auto-detect denied
      if (field === "name") {
        updated.autoDenied = isChargeDenied(val);
      }
      return updated;
    }));
  };

  return (
    <div>
      <Row>
        <Input label="Billed Through" value={billedThrough} onChange={onBilledThroughChange} placeholder="MM/DD" small />
      </Row>
      {charges.map((c, i) => (
        <div key={c.id} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ minWidth: 140 }}>
            {i === 0 && <label style={labelStyle}>Charge Type</label>}
            <select
              value={c.name}
              onChange={e => update(c.id, "name", e.target.value)}
              style={{ ...inputStyle, padding: "5px 8px", fontSize: 11 }}
            >
              <option value="">Select...</option>
              {CHARGE_TYPES.map(ct => (
                <option key={ct.name} value={ct.name}>{ct.name}{ct.denied ? " (AB-2392)" : ""}</option>
              ))}
            </select>
          </div>
          <Input label={i === 0 ? "Amount" : ""} value={c.amount} onChange={v => update(c.id, "amount", v)} type="number" small style={{ maxWidth: 90 }} />
          {c.name?.toLowerCase() === "storage" && (
            <>
              <Input label={i === 0 ? "Rate/Day" : ""} value={c.rate} onChange={v => update(c.id, "rate", v)} type="number" small style={{ maxWidth: 80 }} />
              <Input label={i === 0 ? "Days" : ""} value={c.days} onChange={v => update(c.id, "days", v)} type="number" small style={{ maxWidth: 60 }} />
              <Input label={i === 0 ? "Start" : ""} value={c.startDate} onChange={v => update(c.id, "startDate", v)} placeholder="MM/DD" small style={{ maxWidth: 70 }} />
              <Input label={i === 0 ? "End" : ""} value={c.endDate} onChange={v => update(c.id, "endDate", v)} placeholder="MM/DD" small style={{ maxWidth: 70 }} />
            </>
          )}
          <Input label={i === 0 ? "Note" : ""} value={c.description} onChange={v => update(c.id, "description", v)} placeholder="optional" small style={{ maxWidth: 160 }} />
          {c.autoDenied && (
            <span style={{ color: T.red, fontSize: 8, fontFamily: T.font, letterSpacing: 1, padding: "6px 0", whiteSpace: "nowrap" }}>DENIED</span>
          )}
          <button onClick={() => remove(c.id)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14, padding: "4px 6px" }}>&times;</button>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <Btn onClick={add} color={T.blue} small>+ ADD CHARGE</Btn>
        <span style={{ color: T.textDim, fontSize: 11, fontFamily: T.font }}>
          Total Billed: <span style={{ color: T.text }}>{fmtDollar(calcTotalBilled(charges))}</span>
        </span>
      </div>
    </div>
  );
}

// ─── File Review Timeline ──────────────────────────────────────
const MONTH_MAP = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const DATE_RE = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s*(\d{4})\s+\d{1,2}:\d{2}\s*(?:AM|PM)/i;

/**
 * Parse raw pasted claim notes into date-keyed note blocks.
 * Uses the "Mon DD, YYYY HH:MM AM/PM" timestamp as a reliable anchor
 * to split notes — works regardless of how "Delete/Print/Author" are formatted.
 */
function parseNoteBlocks(rawText) {
  if (!rawText) return {};
  // Normalize line endings
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = {};

  // Find ALL timestamp positions in the text
  const timestamps = [];
  let m;
  const scanRe = new RegExp(DATE_RE.source, "gi");
  while ((m = scanRe.exec(text)) !== null) {
    timestamps.push({ index: m.index, match: m });
  }
  if (timestamps.length === 0) return blocks;

  // For each timestamp, extract the note block (from timestamp to next timestamp's preamble)
  for (let ti = 0; ti < timestamps.length; ti++) {
    const ts = timestamps[ti];
    const mm = MONTH_MAP[ts.match[1].toLowerCase().slice(0, 3)];
    const dd = ts.match[2].padStart(2, "0");
    const key = `${mm}/${dd}`;

    // Note body starts after the timestamp line
    const afterTs = ts.index + ts.match[0].length;
    const bodyStart = text.indexOf("\n", afterTs);
    if (bodyStart < 0) continue;

    // Note body ends at the next note's preamble area (before "Delete" or "Author" preceding the next timestamp)
    let bodyEnd;
    if (ti + 1 < timestamps.length) {
      // Look backwards from next timestamp to find "Delete", "Print", or "Author" keyword
      const nextIdx = timestamps[ti + 1].index;
      const preambleZone = text.substring(Math.max(bodyStart, nextIdx - 300), nextIdx);
      // Find the earliest separator keyword in the preamble zone
      const sepMatch = preambleZone.match(/\n\s*(?:Delete|Print|Author)\b/i);
      if (sepMatch) {
        bodyEnd = Math.max(bodyStart, nextIdx - 300) + sepMatch.index;
      } else {
        bodyEnd = nextIdx;
      }
    } else {
      bodyEnd = text.length;
    }

    const body = text.substring(bodyStart + 1, bodyEnd).trim();
    if (!body) continue;

    // Look backwards from the timestamp to find Author & Topic in the preamble
    const preambleStart = ti > 0 ? (timestamps[ti - 1].index + timestamps[ti - 1].match[0].length) : 0;
    const preamble = text.substring(Math.max(preambleStart, ts.index - 400), ts.index);
    let author = "";
    let topic = "";
    const authorMatch = preamble.match(/Author\s*\n\s*(.+)/i);
    if (authorMatch) author = authorMatch[1].trim();
    const topicMatch = preamble.match(/Topic\s*\n\s*(.+)/i);
    if (topicMatch) topic = topicMatch[1].trim();

    if (!blocks[key]) blocks[key] = [];
    blocks[key].push({ author, topic, body });
  }
  return blocks;
}

/**
 * Score how well a note matches an event description.
 * Extracts keywords from the event and counts how many appear in the note body.
 */
function scoreNoteMatch(eventText, note) {
  if (!eventText) return 0;
  const stopWords = new Set(["the", "a", "an", "of", "to", "in", "for", "on", "at", "is", "was", "and", "or", "by"]);
  const keywords = eventText.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  if (keywords.length === 0) return 0;
  const haystack = (note.body + " " + note.topic + " " + note.author).toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) score++;
  }
  return score / keywords.length; // normalize 0-1
}

function FileReviewEditor({ entries, onChange, rawText = "" }) {
  const add = () => onChange([...entries, { date: "", event: "" }]);
  const remove = (i) => onChange(entries.filter((_, idx) => idx !== i));
  const update = (i, field, val) => onChange(entries.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const [openNote, setOpenNote] = useState(null); // index of row with note open
  const [noteIdx, setNoteIdx] = useState({}); // { [rowIndex]: which note to show if multiple }

  const noteBlocks = React.useMemo(() => parseNoteBlocks(rawText), [rawText]);

  // For a given row, find the best matching note
  const getBestNote = (entry, allNotes) => {
    if (allNotes.length <= 1) return 0;
    let bestIdx = 0;
    let bestScore = -1;
    allNotes.forEach((n, ni) => {
      const s = scoreNoteMatch(entry.event, n);
      if (s > bestScore) { bestScore = s; bestIdx = ni; }
    });
    return bestIdx;
  };

  return (
    <div>
      {entries.map((e, i) => {
        const allNotes = noteBlocks[e.date] || [];
        const hasNotes = allNotes.length > 0;
        const isOpen = openNote === i;
        // Which note to display: user-selected, or best match
        const currentIdx = noteIdx[i] ?? getBestNote(e, allNotes);
        const note = allNotes[currentIdx];

        return (
          <div key={i} style={{ marginBottom: isOpen ? 8 : 4 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <Input label={i === 0 ? "Date" : ""} value={e.date} onChange={v => update(i, "date", v)} placeholder="MM/DD" small style={{ maxWidth: 70 }} />
              <Input label={i === 0 ? "Event" : ""} value={e.event} onChange={v => update(i, "event", v)} placeholder="Event description" small />
              {hasNotes && (
                <span
                  onClick={() => { setOpenNote(isOpen ? null : i); }}
                  title="View raw note"
                  style={{
                    color: isOpen ? T.blue : T.textDim,
                    fontSize: 8,
                    fontFamily: T.font,
                    letterSpacing: 1,
                    cursor: "pointer",
                    padding: "4px 6px",
                    borderRadius: 3,
                    border: `1px solid ${isOpen ? T.blue + "55" : T.textDim + "33"}`,
                    background: isOpen ? T.blue + "15" : "transparent",
                    whiteSpace: "nowrap",
                    marginBottom: 1,
                    transition: "all 0.15s",
                  }}
                >
                  {isOpen ? "HIDE" : "NOTE"}
                </span>
              )}
              <button onClick={() => remove(i)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14, padding: "4px 6px" }}>&times;</button>
            </div>
            {isOpen && note && (
              <div style={{ marginLeft: 76, marginTop: 4 }}>
                <div style={{
                  background: T.inputBg,
                  border: `1px solid ${T.blue}22`,
                  borderLeft: `3px solid ${T.blue}55`,
                  borderRadius: 4,
                  padding: "8px 10px",
                  fontSize: 10,
                  fontFamily: T.font,
                  lineHeight: 1.5,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {note.author && <span style={{ color: T.blue, fontSize: 9 }}>{note.author}</span>}
                      {note.topic && <span style={{ color: T.textDim, fontSize: 9 }}>{note.topic}</span>}
                    </div>
                    {allNotes.length > 1 && (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span
                          onClick={() => setNoteIdx(prev => ({ ...prev, [i]: (currentIdx - 1 + allNotes.length) % allNotes.length }))}
                          style={{ color: T.textDim, fontSize: 10, cursor: "pointer", padding: "0 3px", userSelect: "none" }}
                        >&lsaquo;</span>
                        <span style={{ color: T.textDim, fontSize: 8, fontFamily: T.font }}>{currentIdx + 1}/{allNotes.length}</span>
                        <span
                          onClick={() => setNoteIdx(prev => ({ ...prev, [i]: (currentIdx + 1) % allNotes.length }))}
                          style={{ color: T.textDim, fontSize: 10, cursor: "pointer", padding: "0 3px", userSelect: "none" }}
                        >&rsaquo;</span>
                      </div>
                    )}
                  </div>
                  <div style={{ color: T.textDim, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 200, overflowY: "auto", fontFamily: T.mono, fontSize: 10 }}>
                    {note.body}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Btn onClick={add} color={T.blue} small>+ ADD EVENT</Btn>
    </div>
  );
}

// ─── Pending Documents Panel ────────────────────────────────────
function PendingDocsPanel({ form, onSetField }) {
  const [selectedDocIds, setSelectedDocIds] = useState(
    () => (form.pendingDocs || []).map(d => d.id)
  );
  const [copied, setCopied] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [tone, setTone] = useState("firm");

  // Sync from form when it changes externally
  useEffect(() => {
    const formIds = (form.pendingDocs || []).map(d => d.id);
    if (JSON.stringify(formIds) !== JSON.stringify(selectedDocIds)) {
      setSelectedDocIds(formIds);
    }
  }, [form.pendingDocs]);

  const toggleDoc = (id) => {
    const next = selectedDocIds.includes(id)
      ? selectedDocIds.filter(x => x !== id)
      : [...selectedDocIds, id];
    setSelectedDocIds(next);
    const docs = next.map(did => PENDING_DOC_TYPES.find(dt => dt.id === did)).filter(Boolean);
    if (onSetField) onSetField("pendingDocs", docs);
  };

  const selectedDocs = selectedDocIds.map(id => PENDING_DOC_TYPES.find(dt => dt.id === id)).filter(Boolean);
  const emailText = generatePendingDocsEmail(form, selectedDocs, tone);
  const subjectLine = generatePendingDocsSubject(form);

  const doCopy = async (str, setter) => {
    try { await navigator.clipboard.writeText(str); } catch {
      const ta = document.createElement("textarea"); ta.value = str;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    setter(true); setTimeout(() => setter(false), 2000);
  };

  const handleOutlookOpen = () => {
    const allEmails = (form.shopEmail || "").split(/[;,]\s*/).filter(Boolean);
    const to = allEmails[0] || "";
    const cc = allEmails.slice(1).join(",");
    const subject = encodeURIComponent(subjectLine);
    const body = encodeURIComponent(emailText);
    const ccParam = cc ? `&cc=${encodeURIComponent(cc)}` : "";
    window.open(`mailto:${to}?subject=${subject}&body=${body}${ccParam}`, "_blank");
  };

  return (
    <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 6 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ color: T.amber, fontSize: 10, fontWeight: 600, letterSpacing: 1.5, fontFamily: T.font }}>PENDING DOCUMENTS</span>
        <div style={{ display: "flex", gap: 4 }}>
          <Btn onClick={handleOutlookOpen} color={T.purple} small disabled={selectedDocs.length === 0}>OUTLOOK</Btn>
          <Btn onClick={() => doCopy(emailText, setCopied)} color={copied ? T.green : T.amber} small disabled={selectedDocs.length === 0}>
            {copied ? "COPIED!" : "COPY"}
          </Btn>
        </div>
      </div>

      {/* Doc checkboxes */}
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {PENDING_DOC_TYPES.map(dt => {
            const checked = selectedDocIds.includes(dt.id);
            return (
              <label key={dt.id} style={{
                display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
                padding: "3px 8px", borderRadius: 3,
                background: checked ? `${T.amber}18` : "transparent",
                border: `1px solid ${checked ? T.amber + "55" : T.border}`,
                transition: "all 0.15s",
              }}>
                <input type="checkbox" checked={checked} onChange={() => toggleDoc(dt.id)} style={{ accentColor: T.amber }} />
                <span style={{ color: checked ? T.amber : T.textDim, fontSize: 9, fontFamily: T.font }}>{dt.label}</span>
              </label>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, letterSpacing: 1 }}>TONE</span>
          {[{ key: "firm", label: "FIRM" }, { key: "friendly", label: "FRIENDLY" }].map(t => (
            <button key={t.key} onClick={() => setTone(t.key)} style={{
              background: tone === t.key ? `${T.accent}22` : "none",
              border: `1px solid ${tone === t.key ? T.accent : T.border}`,
              color: tone === t.key ? T.accent : T.textDim,
              fontFamily: T.font, fontSize: 8, letterSpacing: 1, padding: "3px 8px",
              borderRadius: 3, cursor: "pointer",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Subject line */}
      {selectedDocs.length > 0 && (
        <div style={{ padding: "6px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, letterSpacing: 1, minWidth: 36 }}>SUBJ</span>
          <div onClick={() => doCopy(subjectLine, setCopiedSubject)} title="Click to copy" style={{
            flex: 1, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 3,
            padding: "4px 8px", color: copiedSubject ? T.green : T.blue, fontFamily: T.font,
            fontSize: 10, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{copiedSubject ? "Copied!" : subjectLine}</div>
        </div>
      )}

      {/* Email preview */}
      {selectedDocs.length > 0 ? (
        <div style={{ padding: "12px 14px", maxHeight: 300, overflowY: "auto" }}>
          <div style={{ color: T.text, fontFamily: T.font, fontSize: 12, lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {emailText}
          </div>
        </div>
      ) : (
        <div style={{ padding: "20px 14px", textAlign: "center", color: T.textDim, fontSize: 10, fontFamily: T.font }}>
          Select documents above to generate email
        </div>
      )}
    </div>
  );
}

// ─── Follow-Up Timer ────────────────────────────────────────────
function FollowUpTimer({ form, onSetField }) {
  const [timeLeft, setTimeLeft] = useState(null);
  const DEFAULT_HOURS = 4;

  // Countdown tick
  useEffect(() => {
    if (!form.followUpAt) { setTimeLeft(null); return; }
    const tick = () => {
      const diff = new Date(form.followUpAt).getTime() - Date.now();
      setTimeLeft(diff > 0 ? diff : 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [form.followUpAt]);

  const startTimer = (hours) => {
    const target = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    if (onSetField) {
      onSetField("followUpAt", target);
    }
  };

  const clearTimer = () => {
    if (onSetField) {
      onSetField("followUpAt", null);
      onSetField("followUpNote", "");
    }
  };

  const isActive = form.followUpAt && timeLeft !== null && timeLeft > 0;
  const isExpired = form.followUpAt && timeLeft !== null && timeLeft <= 0;

  const formatTime = (ms) => {
    if (ms <= 0) return "00:00:00";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const bgColor = isExpired ? T.danger : isActive ? T.accent : T.textDim;

  return (
    <div style={{
      background: `${bgColor}08`, border: `1px solid ${bgColor}33`,
      borderRadius: 6, padding: "8px 12px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: bgColor, fontSize: 9, fontWeight: 600, letterSpacing: 1.5, fontFamily: T.font }}>FOLLOW UP</span>
          {isActive && (
            <span style={{ color: T.accent, fontSize: 16, fontWeight: 700, fontFamily: T.mono, letterSpacing: 1 }}>
              {formatTime(timeLeft)}
            </span>
          )}
          {isExpired && (
            <span style={{ color: T.danger, fontSize: 12, fontWeight: 700, fontFamily: T.font, letterSpacing: 1, animation: "pulse 1.5s infinite" }}>
              FOLLOW UP NOW
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {!isActive && !isExpired && (
            <>
              <Btn onClick={() => startTimer(1)} color={T.textDim} small>1H</Btn>
              <Btn onClick={() => startTimer(2)} color={T.textDim} small>2H</Btn>
              <Btn onClick={() => startTimer(DEFAULT_HOURS)} color={T.accent} small>4H</Btn>
              <Btn onClick={() => startTimer(8)} color={T.textDim} small>8H</Btn>
            </>
          )}
          {(isActive || isExpired) && (
            <>
              <Btn onClick={clearTimer} color={T.textDim} small>CLEAR</Btn>
              {isExpired && <Btn onClick={() => startTimer(DEFAULT_HOURS)} color={T.accent} small>SNOOZE 4H</Btn>}
            </>
          )}
        </div>
      </div>
      {(isActive || isExpired) && (
        <input
          value={form.followUpNote || ""}
          onChange={e => onSetField && onSetField("followUpNote", e.target.value)}
          placeholder="Follow-up note (e.g. waiting on tow bill...)"
          style={{ ...inputStyle, fontSize: 10, padding: "4px 8px", marginTop: 6 }}
        />
      )}
    </div>
  );
}

// ─── Shop Reputation Badge ──────────────────────────────────────
function ShopReputationBadge({ shopName }) {
  const [rep, setRep] = useState(null);

  useEffect(() => {
    setRep(getShopReputation(shopName));
  }, [shopName]);

  // Completely hidden if no history
  if (!rep) return null;

  const reductionColor = rep.avgReduction > 50 ? T.danger : rep.avgReduction > 25 ? T.amber : T.green;

  return (
    <div style={{
      borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{ color: T.textDim, fontSize: 9, letterSpacing: 1, fontFamily: T.font }}>SHOP HISTORY</span>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.accent, fontSize: 16, fontWeight: 700, fontFamily: T.font }}>{rep.claimCount}</div>
          <div style={{ color: T.textDim, fontSize: 8, letterSpacing: 1, fontFamily: T.font }}>CLAIMS</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: reductionColor, fontSize: 16, fontWeight: 700, fontFamily: T.font }}>{rep.avgReduction}%</div>
          <div style={{ color: T.textDim, fontSize: 8, letterSpacing: 1, fontFamily: T.font }}>AVG REDUCTION</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.green, fontSize: 14, fontWeight: 700, fontFamily: T.font }}>{fmtDollar(rep.totalSaved)}</div>
          <div style={{ color: T.textDim, fontSize: 8, letterSpacing: 1, fontFamily: T.font }}>TOTAL SAVED</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: T.text, fontSize: 14, fontWeight: 700, fontFamily: T.font }}>{fmtDollar(rep.totalApproved)}</div>
          <div style={{ color: T.textDim, fontSize: 8, letterSpacing: 1, fontFamily: T.font }}>TOTAL PAID</div>
        </div>
      </div>
      {rep.avgReduction > 40 && (
        <div style={{ color: T.amber, fontSize: 9, fontFamily: T.font, marginTop: 6 }}>
          This shop has been negotiated {rep.claimCount} time{rep.claimCount > 1 ? "s" : ""} with an average {rep.avgReduction}% reduction — expect pushback.
        </div>
      )}
    </div>
  );
}

// ─── Dual Preview (Template + Email) ───────────────────────────
const TONES = [
  { key: "firm", label: "FIRM", color: T.accent, desc: "First contact" },
  { key: "friendly", label: "FRIENDLY", color: T.accent, desc: "Cooperative" },
  { key: "final", label: "FINAL", color: T.danger, desc: "Last offer" },
];

const MANAGER_EMAIL = "D.sickle@kemper.com";

function DualPreview({ form, onSetField }) {
  const [tab, setTab] = useState("template");
  const [tone, setTone] = useState("firm");
  const [copied, setCopied] = useState(false);
  const [copiedSubject, setCopiedSubject] = useState(false);
  const [emailInputs, setEmailInputs] = useState([""]);
  const [ccManager, setCcManager] = useState(false);
  const [selectedCitationIds, setSelectedCitationIds] = useState([]);
  const [citationDropOpen, setCitationDropOpen] = useState(false);

  const selectedCitations = LEGAL_CITATIONS.filter(c => selectedCitationIds.includes(c.id));
  const templateText = generateTemplate(form);
  const emailText = generateShopEmail(form, tone, selectedCitations);
  const subjectLine = generateSubjectLine(form);
  const text = tab === "template" ? templateText : tab === "email" ? emailText : "";

  const toggleCitation = (id) => {
    setSelectedCitationIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const doCopy = async (str, setter) => {
    try {
      await navigator.clipboard.writeText(str);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = str;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  const handleCopy = () => doCopy(text, setCopied);
  const handleCopySubject = () => doCopy(subjectLine, setCopiedSubject);

  const getAllEmails = () => emailInputs.map(e => e.trim()).filter(Boolean).join("; ");

  const handleEmailSave = () => {
    const combined = getAllEmails();
    if (!combined) return;
    if (onSetField) onSetField("shopEmail", combined);
    if (form.shopName) {
      addRates([{ shopName: form.shopName, email: combined }]);
    }
  };

  // Sync emailInputs when form.shopEmail changes
  useEffect(() => {
    if (form.shopEmail) {
      const parts = form.shopEmail.split(/[;,]\s*/).map(s => s.trim()).filter(Boolean);
      setEmailInputs(parts.length > 0 ? parts : [""]);
    }
  }, [form.shopEmail]);

  const handleOutlookOpen = () => {
    handleEmailSave();
    const allEmails = emailInputs.map(e => e.trim()).filter(Boolean);
    const to = allEmails[0] || "";
    const ccList = [...allEmails.slice(1)];
    if (ccManager) ccList.push(MANAGER_EMAIL);
    const cc = ccList.join(",");
    const subject = encodeURIComponent(subjectLine);
    const body = encodeURIComponent(emailText);
    const ccParam = cc ? `&cc=${encodeURIComponent(cc)}` : "";
    window.open(`mailto:${to}?subject=${subject}&body=${body}${ccParam}`, "_blank");
  };

  return (
    <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 6, display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display: "flex", gap: 3 }}>
          {[
            { key: "template", label: "Internal Template" },
            { key: "email", label: "Shop Email" },
            { key: "docs", label: `Pending Docs${(form.pendingDocs || []).length > 0 ? ` (${form.pendingDocs.length})` : ""}` },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: tab === t.key ? `${T.accent}14` : "none",
                border: `1px solid ${tab === t.key ? T.accent + "44" : "transparent"}`,
                color: tab === t.key ? T.text : T.textDim,
                fontFamily: T.font,
                fontSize: 10,
                fontWeight: tab === t.key ? 500 : 400,
                letterSpacing: 0.3,
                padding: "5px 12px",
                borderRadius: 6,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {tab === "email" && (
            <Btn onClick={handleOutlookOpen} color={T.purple} small title="Open in Outlook with subject & body pre-filled">
              OUTLOOK
            </Btn>
          )}
          {tab !== "docs" && (
            <Btn onClick={handleCopy} color={copied ? T.green : T.amber} small>
              {copied ? "COPIED!" : "COPY"}
            </Btn>
          )}
        </div>
      </div>

      {/* Tone selector + Subject line (email tab only) */}
      {tab === "email" && (
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Tone pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, letterSpacing: 1, minWidth: 36 }}>TONE</span>
            <div style={{ display: "flex", gap: 3 }}>
              {TONES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTone(t.key)}
                  title={t.desc}
                  style={{
                    background: tone === t.key ? `${t.color}22` : "none",
                    border: `1px solid ${tone === t.key ? t.color : T.border}`,
                    color: tone === t.key ? t.color : T.textDim,
                    fontFamily: T.font,
                    fontSize: 8,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    borderRadius: 3,
                    cursor: "pointer",
                    transition: "all .15s",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, opacity: 0.5, marginLeft: 4 }}>
              {TONES.find(t => t.key === tone)?.desc || ""}
            </span>
          </div>
          {/* TO email(s) */}
          {emailInputs.map((em, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, letterSpacing: 1, minWidth: 36 }}>{idx === 0 ? "TO" : "CC"}</span>
              <input
                type="email"
                value={em}
                onChange={e => { const next = [...emailInputs]; next[idx] = e.target.value; setEmailInputs(next); }}
                onBlur={handleEmailSave}
                onKeyDown={e => { if (e.key === "Enter") handleEmailSave(); }}
                placeholder="shop@email.com"
                style={{ ...inputStyle, flex: 1, fontSize: 10, padding: "4px 8px" }}
              />
              {idx === 0 ? (
                <button onClick={() => setEmailInputs(prev => [...prev, ""])} title="Add CC email" style={{ background: "none", border: `1px solid ${T.border}`, color: T.accent, cursor: "pointer", fontSize: 14, fontWeight: 700, width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 3, lineHeight: 1 }}>+</button>
              ) : (
                <button onClick={() => { const next = emailInputs.filter((_, i) => i !== idx); setEmailInputs(next.length ? next : [""]); handleEmailSave(); }} title="Remove" style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14 }}>&times;</button>
              )}
            </div>
          ))}
          {/* Subject line */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, letterSpacing: 1, minWidth: 36 }}>SUBJ</span>
            <div
              onClick={handleCopySubject}
              title="Click to copy subject line"
              style={{
                flex: 1,
                background: T.bg,
                border: `1px solid ${T.border}`,
                borderRadius: 3,
                padding: "4px 8px",
                color: copiedSubject ? T.green : T.blue,
                fontFamily: T.font,
                fontSize: 10,
                cursor: "pointer",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                transition: "color .15s",
              }}
            >
              {copiedSubject ? "Copied!" : subjectLine}
            </div>
          </div>
          {/* Manager CC + Citations */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={ccManager} onChange={e => setCcManager(e.target.checked)} style={{ accentColor: T.accent }} />
              <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font }}>CC Manager</span>
            </label>
            <div style={{ position: "relative" }}>
              <button onClick={() => setCitationDropOpen(!citationDropOpen)} style={{ ...btnStyle(selectedCitationIds.length > 0 ? T.amber : T.textDim, true), fontSize: 8 }}>
                ADD TO EMAIL {selectedCitationIds.length > 0 ? `(${selectedCitationIds.length})` : ""}
              </button>
              {citationDropOpen && (
                <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 4, padding: 6, minWidth: 260, marginTop: 2, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
                  {LEGAL_CITATIONS.map(c => (
                    <label key={c.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 2px", cursor: "pointer" }}>
                      <input type="checkbox" checked={selectedCitationIds.includes(c.id)} onChange={() => toggleCitation(c.id)} style={{ accentColor: T.amber, marginTop: 2 }} />
                      <span style={{ color: T.text, fontSize: 9, fontFamily: T.font, lineHeight: 1.4 }}>{c.label}</span>
                    </label>
                  ))}
                  <button onClick={() => setCitationDropOpen(false)} style={{ ...btnStyle(T.accent, true), fontSize: 8, marginTop: 4, width: "100%" }}>DONE</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview content */}
      {tab === "docs" ? (
        <div style={{ flex: 1, overflow: "auto" }}>
          <PendingDocsPanel form={form} onSetField={onSetField} />
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "auto", padding: "16px 18px" }}>
          <div style={{
            color: T.text,
            fontFamily: T.font,
            fontSize: 13,
            lineHeight: 1.8,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            margin: 0,
            letterSpacing: 0.15,
          }}>
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Urgent Pickup Note (auto-filled, copyable) ──────────────
function UrgentPickupNote({ form }) {
  const [copied, setCopied] = useState(false);

  const now = new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const timeStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });
  const approved = fmtDollar(form.resolution?.approvedCharges || 0);

  const note = `***HIGH STORAGE TEAM JALAENA GILBERT**URGENT PICKUP**CHARGES APPROVED ${approved} FOR ${dateStr} (Its ${timeStr}) Thank you!***`;

  const handleCopy = () => {
    navigator.clipboard.writeText(note);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ marginTop: 16, background: `${T.amber}08`, border: `1px solid ${T.amber}33`, borderRadius: 6, padding: "10px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: T.amber, fontSize: 9, fontWeight: 600, letterSpacing: 1.5, fontFamily: T.font }}>URGENT PICKUP NOTE</span>
        <button onClick={handleCopy} style={{
          background: copied ? `${T.success}22` : `${T.accent}12`,
          border: `1px solid ${copied ? T.success + "55" : T.accent + "33"}`,
          color: copied ? T.success : T.accent,
          fontSize: 9, fontFamily: T.font, fontWeight: 600, padding: "4px 12px",
          borderRadius: 4, cursor: "pointer", letterSpacing: 0.5,
        }}>{copied ? "COPIED!" : "COPY"}</button>
      </div>
      <div style={{
        color: T.text, fontSize: 11, fontFamily: T.mono, fontWeight: 600,
        background: T.inputBg, padding: "8px 10px", borderRadius: 4,
        border: `1px solid ${T.border}`, lineHeight: 1.5, wordBreak: "break-word",
      }}>
        {note}
      </div>
    </div>
  );
}

// ─── Home Dashboard ───────────────────────────────────────────
function HomeDashboard({ onNewClaim, onLoadClaim, onUpdateStatus }) {
  const [templates, setTemplates] = useState([]);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  useEffect(() => { setTemplates(getTemplates()); }, []);

  const pending = templates.filter(t => t.status === "pending");
  const negotiating = templates.filter(t => t.status === "negotiating");
  const escalated = templates.filter(t => t.status === "escalated");
  const completed = templates.filter(t => t.status === "completed");

  // Savings = sum of (billed - approved) for completed claims
  const allWithSavings = templates.filter(t => t.resolution?.approvedCharges > 0);
  const now = new Date();
  const thisMonth = allWithSavings.filter(t => {
    const d = t.updatedAt || t.createdAt;
    if (!d) return false;
    const dt = new Date(d);
    return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear();
  });
  const thisWeek = allWithSavings.filter(t => {
    const d = t.updatedAt || t.createdAt;
    if (!d) return false;
    const dt = new Date(d);
    const diff = (now - dt) / (1000 * 60 * 60 * 24);
    return diff <= 7;
  });

  const calcSavings = (list) => list.reduce((sum, t) => {
    const billed = calcTotalBilled(t.charges);
    const approved = t.resolution?.approvedCharges || 0;
    return sum + Math.max(0, billed - approved);
  }, 0);
  const calcApproved = (list) => list.reduce((sum, t) => sum + (t.resolution?.approvedCharges || 0), 0);

  const monthSavings = calcSavings(thisMonth);
  const weekSavings = calcSavings(thisWeek);
  const totalSavings = calcSavings(allWithSavings);
  const monthApproved = calcApproved(thisMonth);
  const monthClaims = thisMonth.length;
  const totalClaims = allWithSavings.length;

  const handleStatusChange = (id, newStatus) => {
    const updated = templates.map(t => t.id === id ? { ...t, status: newStatus, updatedAt: new Date().toISOString() } : t);
    safeSetTemplates(updated);
    if (onUpdateStatus) onUpdateStatus(id, newStatus);
  };

  const safeSetTemplates = (updated) => {
    // Save to localStorage directly
    try { localStorage.setItem("hst-templates", JSON.stringify(updated)); } catch {}
    setTemplates(updated);
  };

  const statusPill = (status) => {
    const s = CLAIM_STATUSES.find(cs => cs.key === status) || CLAIM_STATUSES[0];
    return { background: `${s.color}18`, color: s.color, border: `1px solid ${s.color}33` };
  };

  const ClaimCard = ({ claim }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const st = CLAIM_STATUSES.find(s => s.key === claim.status) || CLAIM_STATUSES[0];
    const isFollowUpExpired = claim.followUpAt && new Date(claim.followUpAt).getTime() <= Date.now();
    return (
      <div style={{
        background: T.cardBg,
        border: `1px solid ${isFollowUpExpired ? T.danger + "66" : T.border}`,
        borderRadius: 6,
        padding: "10px 12px", cursor: "pointer", position: "relative",
        borderLeft: `3px solid ${isFollowUpExpired ? T.danger : st.color}`,
        animation: isFollowUpExpired ? "pulseGlow 2s infinite" : "none",
      }}>
        {isFollowUpExpired && (
          <div style={{
            color: T.danger, fontSize: 8, fontWeight: 700, letterSpacing: 1.5,
            fontFamily: T.font, marginBottom: 4, animation: "pulse 1.5s infinite",
          }}>FOLLOW UP NOW</div>
        )}
        <div onClick={() => onLoadClaim(claim)} style={{ marginBottom: 6 }}>
          <div style={{ color: T.text, fontSize: 11, fontWeight: 600, fontFamily: T.font }}>{claim.claimNumber || "No Claim #"}</div>
          <div style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>{claim.shopName || "No Shop"}</div>
          <div style={{ color: T.textMuted, fontSize: 9, fontFamily: T.font, marginTop: 2 }}>
            {[claim.vehicleYear, claim.vehicleMake, claim.vehicleModel].filter(Boolean).join(" ")}
          </div>
          {claim.resolution?.approvedCharges > 0 && (
            <div style={{ color: T.accent, fontSize: 10, fontFamily: T.font, marginTop: 3 }}>{fmtDollar(claim.resolution.approvedCharges)}</div>
          )}
          {claim.followUpNote && isFollowUpExpired && (
            <div style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, fontStyle: "italic", marginTop: 2 }}>{claim.followUpNote}</div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ position: "relative" }}>
            <button onClick={() => setMenuOpen(!menuOpen)} style={{
              ...statusPill(claim.status), fontSize: 8, padding: "2px 8px", borderRadius: 3,
              fontFamily: T.font, cursor: "pointer", letterSpacing: 0.5, fontWeight: 600, textTransform: "uppercase",
            }}>{st.label}</button>
            {menuOpen && (
              <div style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 4, padding: 4, marginTop: 2, boxShadow: "0 4px 12px rgba(0,0,0,0.5)", minWidth: 100 }}>
                {CLAIM_STATUSES.filter(s => s.key !== claim.status).map(s => (
                  <button key={s.key} onClick={() => { handleStatusChange(claim.id, s.key); setMenuOpen(false); }} style={{
                    display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                    color: s.color, fontSize: 9, fontFamily: T.font, padding: "4px 8px", cursor: "pointer", borderRadius: 3,
                  }}>{s.label}</button>
                ))}
              </div>
            )}
          </div>
          <span style={{ color: T.textMuted, fontSize: 8, fontFamily: T.font }}>
            {claim.updatedAt ? new Date(claim.updatedAt).toLocaleDateString() : ""}
          </span>
        </div>
      </div>
    );
  };

  const ColumnHeader = ({ label, count, color }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span style={{ color: T.text, fontSize: 11, fontWeight: 600, fontFamily: T.font, letterSpacing: 1 }}>{label}</span>
      <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>({count})</span>
    </div>
  );

  return (
    <div>
      {/* Motivational quote */}
      <div style={{ textAlign: "center", padding: "16px 30px 20px", marginBottom: 16 }}>
        <div style={{ color: T.textDim, fontSize: 12, fontFamily: T.font, fontStyle: "italic", lineHeight: 1.6, maxWidth: 500, margin: "0 auto" }}>
          "{quote}"
        </div>
      </div>

      {/* Savings Hero */}
      <div style={{ background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "20px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ color: T.textDim, fontSize: 9, letterSpacing: 2, fontFamily: T.font, textTransform: "uppercase", marginBottom: 4 }}>SAVINGS DASHBOARD</div>
            <div style={{ color: T.text, fontSize: 10, fontFamily: T.font }}>Jalaena Gilbert — High Storage Team</div>
          </div>
          <button onClick={onNewClaim} style={{
            background: `${T.accent}20`, border: `1px solid ${T.accent}55`, color: T.accent,
            padding: "10px 24px", borderRadius: 6, cursor: "pointer", fontFamily: T.font,
            fontSize: 12, fontWeight: 600, letterSpacing: 1,
          }}>+ NEW CLAIM</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div style={{ background: T.bg, borderRadius: 6, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ color: "#4ade80", fontSize: 22, fontWeight: 700, fontFamily: T.font }}>{fmtDollar(weekSavings)}</div>
            <div style={{ color: T.textDim, fontSize: 9, letterSpacing: 1.5, fontFamily: T.font, marginTop: 4 }}>THIS WEEK</div>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ color: "#4ade80", fontSize: 22, fontWeight: 700, fontFamily: T.font }}>{fmtDollar(monthSavings)}</div>
            <div style={{ color: T.textDim, fontSize: 9, letterSpacing: 1.5, fontFamily: T.font, marginTop: 4 }}>THIS MONTH</div>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ color: T.accent, fontSize: 22, fontWeight: 700, fontFamily: T.font }}>{monthClaims}</div>
            <div style={{ color: T.textDim, fontSize: 9, letterSpacing: 1.5, fontFamily: T.font, marginTop: 4 }}>CLAIMS THIS MONTH</div>
          </div>
          <div style={{ background: T.bg, borderRadius: 6, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ color: T.text, fontSize: 22, fontWeight: 700, fontFamily: T.font }}>{fmtDollar(totalSavings)}</div>
            <div style={{ color: T.textDim, fontSize: 9, letterSpacing: 1.5, fontFamily: T.font, marginTop: 4 }}>ALL TIME ({totalClaims} claims)</div>
          </div>
        </div>
        {monthApproved > 0 && (
          <div style={{ marginTop: 10, textAlign: "center" }}>
            <span style={{ color: T.textDim, fontSize: 9, fontFamily: T.font }}>Total approved this month: {fmtDollar(monthApproved)}</span>
          </div>
        )}
      </div>

      {/* Status columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
        {/* Pending */}
        <div>
          <ColumnHeader label="PENDING" count={pending.length} color="#d4a040" />
          <div style={{ display: "grid", gap: 6 }}>
            {pending.length === 0 && <div style={{ color: T.textMuted, fontSize: 10, fontFamily: T.font, padding: 12, textAlign: "center" }}>No pending claims</div>}
            {pending.map(c => <ClaimCard key={c.id} claim={c} />)}
          </div>
        </div>
        {/* Negotiating */}
        <div>
          <ColumnHeader label="NEGOTIATING" count={negotiating.length} color="#6b8afd" />
          <div style={{ display: "grid", gap: 6 }}>
            {negotiating.length === 0 && <div style={{ color: T.textMuted, fontSize: 10, fontFamily: T.font, padding: 12, textAlign: "center" }}>No active negotiations</div>}
            {negotiating.map(c => <ClaimCard key={c.id} claim={c} />)}
          </div>
        </div>
        {/* Escalated */}
        <div>
          <ColumnHeader label="ESCALATED" count={escalated.length} color="#e05555" />
          <div style={{ display: "grid", gap: 6 }}>
            {escalated.length === 0 && <div style={{ color: T.textMuted, fontSize: 10, fontFamily: T.font, padding: 12, textAlign: "center" }}>No escalated claims</div>}
            {escalated.map(c => <ClaimCard key={c.id} claim={c} />)}
          </div>
        </div>
      </div>

      {/* Recently Completed */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80" }} />
          <span style={{ color: T.text, fontSize: 11, fontWeight: 600, fontFamily: T.font, letterSpacing: 1 }}>RECENTLY COMPLETED</span>
          <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>({completed.length})</span>
        </div>
        {completed.length === 0 ? (
          <div style={{ color: T.textMuted, fontSize: 10, fontFamily: T.font, padding: 16, textAlign: "center" }}>No completed claims yet. Get to work!</div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            {completed.slice(0, 10).map(c => {
              const billed = calcTotalBilled(c.charges);
              const approved = c.resolution?.approvedCharges || 0;
              const saved = Math.max(0, billed - approved);
              return (
                <div key={c.id} onClick={() => onLoadClaim(c)} style={{
                  display: "grid", gridTemplateColumns: "1fr 1fr 80px 80px 80px 60px", gap: 8, alignItems: "center",
                  padding: "8px 12px", background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 4, cursor: "pointer",
                  borderLeft: `3px solid #4ade80`,
                }}>
                  <span style={{ color: T.text, fontSize: 11, fontFamily: T.font, fontWeight: 500 }}>{c.claimNumber || "-"}</span>
                  <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>{c.shopName || "-"}</span>
                  <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>Billed: {fmtDollar(billed)}</span>
                  <span style={{ color: T.accent, fontSize: 10, fontFamily: T.font }}>Paid: {fmtDollar(approved)}</span>
                  <span style={{ color: "#4ade80", fontSize: 10, fontFamily: T.font, fontWeight: 600 }}>Saved: {fmtDollar(saved)}</span>
                  <span style={{ color: T.textMuted, fontSize: 9, fontFamily: T.font, textAlign: "right" }}>
                    {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ""}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── History List ──────────────────────────────────────────────
function HistoryList({ onLoad }) {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => { setTemplates(getTemplates()); }, []);

  const filtered = templates.filter(t =>
    (t.claimNumber || "").toLowerCase().includes(search.toLowerCase()) ||
    (t.shopName || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = (id) => {
    const updated = deleteTemplate(id);
    setTemplates(updated);
  };

  return (
    <div>
      <Row>
        <Input label="Search" value={search} onChange={setSearch} placeholder="Claim #, shop name..." />
      </Row>
      {filtered.length === 0 && (
        <div style={{ color: T.textDim, fontSize: 12, fontFamily: T.font, textAlign: "center", padding: 40 }}>
          {templates.length === 0 ? "No saved templates yet. Create your first one!" : "No matches found."}
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {filtered.map(t => (
          <div
            key={t.id}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: T.cardBg, border: `1px solid ${T.border}`, borderRadius: 6, padding: "12px 14px",
            }}
          >
            <div style={{ flex: 1, cursor: "pointer" }} onClick={() => onLoad(t)}>
              <div style={{ color: T.green, fontSize: 12, fontWeight: 600, fontFamily: T.font }}>{t.claimNumber || "No Claim #"}</div>
              <div style={{ color: T.text, fontSize: 11, fontFamily: T.font }}>{t.shopName || "No Shop"}</div>
              <div style={{ color: T.textDim, fontSize: 10, fontFamily: T.font, marginTop: 2 }}>
                {t.vehicleYear} {t.vehicleMake} {t.vehicleModel} | {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {t.resolution?.approvedCharges > 0 && (
                <span style={{ color: T.amber, fontSize: 11, fontFamily: T.font }}>{fmtDollar(t.resolution.approvedCharges)}</span>
              )}
              <Btn onClick={() => onLoad(t)} color={T.blue} small>LOAD</Btn>
              <button onClick={() => handleDelete(t.id)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 16 }}>&times;</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Rate Database ─────────────────────────────────────────────
function RateDatabaseView() {
  const [rates, setRates] = useState([]);
  const [search, setSearch] = useState("");
  const [zipFilter, setZipFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null); // shopName to confirm
  const [editing, setEditing] = useState(null); // { shopName, field, value }
  const [letterFilter, setLetterFilter] = useState(""); // active letter filter

  useEffect(() => { setRates(getRates()); }, []);

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const newRates = rows.map(row => ({
        shopName: row["Shop Name"] || row["Name"] || row["shop_name"] || row["SHOP"] || Object.values(row)[0] || "",
        address: row["Address"] || row["address"] || row["ADDR"] || "",
        marketRate: parseFloat(row["Rate"] || row["Daily Rate"] || row["rate"] || row["RATE"] || row["Storage Rate"] || 0),
        towRate: parseFloat(row["Tow Rate"] || row["tow_rate"] || row["TOW"] || 0),
        phone: row["Phone"] || row["phone"] || row["PHONE"] || "",
        email: row["Email"] || row["email"] || row["EMAIL"] || "",
        license: row["License"] || row["BAR"] || row["license"] || "",
        source: `Imported ${new Date().toLocaleDateString()}`,
      })).filter(r => r.shopName);
      const updated = addRates(newRates);
      setRates(updated);
    } catch (err) {
      alert("Import failed: " + err.message);
    }
    e.target.value = "";
  };

  const handleDeleteRate = (name) => {
    if (confirmDelete === name) {
      const updated = deleteRate(name);
      setRates(updated);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(name);
    }
  };

  const handleEditField = (shopName, field, value) => {
    const updated = rates.map(r => {
      if (r.shopName === shopName) {
        if (field === "marketRate") return { ...r, [field]: parseFloat(value) || 0 };
        return { ...r, [field]: value };
      }
      return r;
    });
    setRates(updated);
    saveRates(updated);
    setEditing(null);
  };

  const startEdit = (shopName) => {
    const shop = rates.find(r => r.shopName === shopName);
    if (shop) setEditing({ shopName, rate: shop.marketRate || 0, phone: shop.phone || "", email: shop.email || "", address: shop.address || "" });
  };

  // Extract zip code from address (5-digit or 5+4 at end of string)
  const getZip = (addr) => {
    if (!addr) return "";
    const m = addr.match(/\b(\d{5})(?:-\d{4})?\s*$/);
    return m ? m[1] : "";
  };

  // Filter by search, zip code, and letter
  const filtered = rates.filter(r => {
    const matchesSearch = !search ||
      r.shopName.toLowerCase().includes(search.toLowerCase()) ||
      (r.address || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.email || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.phone || "").includes(search);
    const zip = getZip(r.address) || (r.zip || "");
    const matchesZip = !zipFilter || zip.startsWith(zipFilter);
    const first = (r.shopName || "")[0]?.toUpperCase();
    const matchesLetter = !letterFilter ||
      (letterFilter === "#" ? !/^[A-Z]/i.test(r.shopName || "") : first === letterFilter);
    return matchesSearch && matchesZip && matchesLetter;
  });

  // Sort alphabetically by shop name
  const sorted = [...filtered].sort((a, b) => {
    const aName = (a.shopName || "").toUpperCase();
    const bName = (b.shopName || "").toUpperCase();
    const aIsLetter = /^[A-Z]/.test(aName);
    const bIsLetter = /^[A-Z]/.test(bName);
    if (!aIsLetter && bIsLetter) return -1;
    if (aIsLetter && !bIsLetter) return 1;
    return aName.localeCompare(bName);
  });

  // Build legend: # for non-alpha, then A-Z
  const letterSet = new Set();
  let hasNumeric = false;
  sorted.forEach(r => {
    const first = (r.shopName || "")[0]?.toUpperCase();
    if (first && /[A-Z]/.test(first)) letterSet.add(first);
    else if (first) hasNumeric = true;
  });
  const legend = [];
  if (hasNumeric) legend.push("#");
  for (let c = 65; c <= 90; c++) legend.push(String.fromCharCode(c));

  // Unique zip codes for quick filter chips
  const zipCodes = [...new Set(
    rates.map(r => getZip(r.address) || r.zip || "").filter(z => z.length === 5)
  )].sort();

  const toggleLetterFilter = (letter) => {
    setLetterFilter(prev => prev === letter ? "" : letter);
  };

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {/* Legend sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, position: "sticky", top: 16, alignSelf: "flex-start", paddingTop: 80 }}>
        {legend.map(l => {
          const hasEntries = l === "#" ? hasNumeric : letterSet.has(l);
          const isActive = letterFilter === l;
          return (
            <button key={l} onClick={() => hasEntries && toggleLetterFilter(l)} style={{
              background: isActive ? T.accent : "none", border: "none",
              color: isActive ? T.bg : hasEntries ? T.accent : T.textMuted,
              fontSize: 10, fontFamily: T.mono, fontWeight: 700, cursor: hasEntries ? "pointer" : "default",
              padding: "1px 6px", lineHeight: "14px", opacity: hasEntries ? 1 : 0.3,
              borderRadius: 3,
            }}>{l}</button>
          );
        })}
        {letterFilter && (
          <button onClick={() => setLetterFilter("")} style={{
            background: "none", border: "none", color: T.red,
            fontSize: 8, fontFamily: T.font, cursor: "pointer",
            padding: "2px 6px", marginTop: 4,
          }}>CLR</button>
        )}
      </div>

      {/* Main list */}
      <div style={{ flex: 1 }}>
        <Row gap={12}>
          <Input label="Search" value={search} onChange={setSearch} placeholder="Name, address, phone, email..." />
          <Input label="Zip Code" value={zipFilter} onChange={setZipFilter} placeholder="e.g. 90220" small />
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <label style={{ ...btnStyle(T.amber), display: "inline-block", cursor: "pointer" }}>
              IMPORT CSV/XLSX
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} style={{ display: "none" }} />
            </label>
          </div>
        </Row>
        {zipFilter && (
          <div style={{ display: "flex", gap: 4, margin: "8px 0" }}>
            <button onClick={() => setZipFilter("")} style={{ ...btnStyle(T.textDim, true), fontSize: 9 }}>CLEAR ZIP FILTER</button>
            <span style={{ color: T.accent, fontSize: 10, fontFamily: T.font, alignSelf: "center" }}>Filtering: {zipFilter}</span>
          </div>
        )}
        <div style={{ color: T.textDim, fontSize: 10, fontFamily: T.font, padding: "4px 0" }}>
          {sorted.length} shop{sorted.length !== 1 ? "s" : ""}
        </div>
        {sorted.length === 0 ? (
          <div style={{ color: T.textDim, fontSize: 12, fontFamily: T.font, textAlign: "center", padding: 40 }}>
            {rates.length === 0 ? "No rates imported yet. Import your spreadsheet above." : "No matches."}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1.2fr 1.5fr 70px 50px", gap: 6, padding: "8px 10px", borderBottom: `1px solid ${T.border}` }}>
              {["Name", "Address", "Phone", "Email", "Rate", ""].map((h, hi) => (
                <span key={hi} style={{ color: T.textDim, fontSize: 9, letterSpacing: 1, fontFamily: T.font, textTransform: "uppercase" }}>{h}</span>
              ))}
            </div>
            {sorted.map((r, i) => {
              const first = (r.shopName || "")[0]?.toUpperCase();
              const prevFirst = i > 0 ? (sorted[i - 1].shopName || "")[0]?.toUpperCase() : null;
              const showDivider = i === 0 || first !== prevFirst;
              const sectionLabel = first && /[A-Z]/.test(first) ? first : "#";
              const isEditing = editing && editing.shopName === r.shopName;
              const isConfirming = confirmDelete === r.shopName;
              return (
                <React.Fragment key={i}>
                  {showDivider && !letterFilter && (
                    <div style={{ padding: "6px 10px 2px", color: T.accent, fontSize: 11, fontWeight: 700, fontFamily: T.font, borderBottom: `1px solid ${T.border}22` }}>
                      {sectionLabel}
                    </div>
                  )}
                  <div id={`shop-${r.shopName.replace(/\s/g, "-")}`} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1.2fr 1.5fr 70px 50px", gap: 6, padding: "6px 10px", background: i % 2 === 0 ? T.cardBg : "transparent", borderRadius: 4, alignItems: "center" }}>
                    <span style={{ color: T.text, fontSize: 11, fontFamily: T.font }}>{r.shopName}</span>
                    {isEditing ? (
                      <input value={editing.address} onChange={e => setEditing(p => ({ ...p, address: e.target.value }))} onBlur={() => handleEditField(r.shopName, "address", editing.address)} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px" }} />
                    ) : (
                      <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.address || "-"}</span>
                    )}
                    {isEditing ? (
                      <input value={editing.phone} onChange={e => setEditing(p => ({ ...p, phone: e.target.value }))} onBlur={() => handleEditField(r.shopName, "phone", editing.phone)} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px" }} />
                    ) : (
                      <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>{r.phone || "-"}</span>
                    )}
                    {isEditing ? (
                      <input value={editing.email} onChange={e => setEditing(p => ({ ...p, email: e.target.value }))} onBlur={() => handleEditField(r.shopName, "email", editing.email)} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px" }} />
                    ) : (
                      <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email || "-"}</span>
                    )}
                    {isEditing ? (
                      <input type="number" value={editing.rate} onChange={e => setEditing(p => ({ ...p, rate: e.target.value }))} onBlur={() => handleEditField(r.shopName, "marketRate", editing.rate)} style={{ ...inputStyle, fontSize: 10, padding: "3px 6px", width: 60 }} />
                    ) : (
                      <span style={{ color: T.green, fontSize: 11, fontFamily: T.font }}>${fmt(r.marketRate)}</span>
                    )}
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      {isEditing ? (
                        <button onClick={() => setEditing(null)} style={{ background: "none", border: "none", color: T.green, cursor: "pointer", fontSize: 10, fontFamily: T.font }}>DONE</button>
                      ) : (
                        <button onClick={() => startEdit(r.shopName)} style={{ background: "none", border: "none", color: T.blue, cursor: "pointer", fontSize: 10, fontFamily: T.font }}>EDIT</button>
                      )}
                      {isConfirming ? (
                        <>
                          <button onClick={() => handleDeleteRate(r.shopName)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 9, fontFamily: T.font, fontWeight: 700 }}>YES</button>
                          <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 9, fontFamily: T.font }}>NO</button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDelete(r.shopName)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14 }}>&times;</button>
                      )}
                    </div>
                  </div>
                  {isConfirming && (
                    <div style={{ padding: "4px 10px 4px 10px", color: T.amber, fontSize: 10, fontFamily: T.font }}>
                      Are you sure you want to delete {r.shopName}?
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Panel ────────────────────────────────────────────
function SettingsPanel() {
  const [settings, setSettings] = useState(getSettings);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const update = (field, val) => setSettings(prev => ({ ...prev, [field]: val }));

  return (
    <div style={{ maxWidth: 600 }}>
      <Section title="GEMINI API" accent={T.accent}>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>API KEY</label>
          <input
            type="password"
            value={settings.apiKey || ""}
            onChange={e => update("apiKey", e.target.value)}
            placeholder="Enter your Gemini API key..."
            style={{ ...inputStyle, fontSize: 12 }}
          />
          <div style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, marginTop: 4 }}>
            Get a key at ai.google.dev. Stored locally in your browser only.
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>MODEL</label>
          <input
            type="text"
            value={settings.model || "gemini-2.0-flash"}
            onChange={e => update("model", e.target.value)}
            placeholder="e.g. gemini-2.0-flash"
            style={{ ...inputStyle, fontSize: 12 }}
            list="gemini-models"
          />
          <datalist id="gemini-models">
            {GEMINI_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </datalist>
          <div style={{ color: T.textDim, fontSize: 9, fontFamily: T.font, marginTop: 4 }}>
            Type any model ID or pick from suggestions. Check ai.google.dev/models for available models.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Btn onClick={handleSave} color={saved ? T.green : T.amber}>
            {saved ? "SAVED!" : "SAVE SETTINGS"}
          </Btn>
          {settings.apiKey && (
            <span style={{ color: T.green, fontSize: 10, fontFamily: T.font }}>Key configured ({settings.apiKey.slice(0, 8)}...)</span>
          )}
        </div>
      </Section>

      <Section title="DEFAULTS" accent={T.accent} defaultOpen={false}>
        <Row>
          <Input
            label="Default Market Rate (LA)"
            value={settings.defaultRateLA || 250}
            onChange={v => update("defaultRateLA", v)}
            type="number"
          />
          <Input
            label="Mitigation Days"
            value={settings.mitigationDays || 3}
            onChange={v => update("mitigationDays", v)}
            type="number"
          />
        </Row>
        <Row>
          <Input
            label="Your Name"
            value={settings.userName || ""}
            onChange={v => update("userName", v)}
            placeholder="For auto-fill in templates"
          />
          <Input
            label="Your Role"
            value={settings.userRole || ""}
            onChange={v => update("userRole", v)}
            placeholder="e.g. HST, PA, AL"
          />
        </Row>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={handleSave} color={saved ? T.green : T.blue}>
            {saved ? "SAVED!" : "SAVE"}
          </Btn>
        </div>
      </Section>

      <Section title="ABOUT" accent={T.textDim} defaultOpen={false}>
        <div style={{ color: T.textDim, fontSize: 11, fontFamily: T.font, lineHeight: 1.8 }}>
          <div><span style={{ color: T.green }}>HST COMMAND</span> v1.0</div>
          <div>High Storage Template Generator</div>
          <div style={{ marginTop: 8 }}>Built-in rules: AB-2392 compliance, mitigation window calculator, market rate defaults, dual output (internal template + shop email).</div>
          <div style={{ marginTop: 4 }}>All data is stored locally in your browser. Nothing is sent anywhere except the Gemini API when you use Smart Fill.</div>
        </div>
      </Section>
    </div>
  );
}

// ─── Shop Contact Log Component ─────────────────────────────────
function ShopContactLog({ shopName }) {
  const [contacts, setContacts] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [spoke, setSpoke] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setContacts(getShopContactsByName(shopName));
  }, [shopName]);

  const handleAdd = () => {
    if (!newNote.trim()) return;
    const updated = addShopContact({
      shopName,
      spokeTo: spoke,
      note: newNote,
      claimRelated: true,
    });
    setContacts(updated.filter(e => e.shopName.toLowerCase() === shopName.toLowerCase()));
    setNewNote("");
    setSpoke("");
  };

  const handleDelete = (id) => {
    const all = deleteShopContact(id);
    setContacts(all.filter(e => e.shopName.toLowerCase() === shopName.toLowerCase()));
  };

  const visible = showAll ? contacts : contacts.slice(0, 3);

  return (
    <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{ color: T.textDim, fontSize: 9, letterSpacing: 1, fontFamily: T.font }}>SHOP CONTACT LOG</span>
        {contacts.length > 0 && <span style={{ color: T.blue, fontSize: 9, fontFamily: T.font }}>({contacts.length})</span>}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        <input
          value={spoke}
          onChange={e => setSpoke(e.target.value)}
          placeholder="Spoke to..."
          style={{ ...inputStyle, fontSize: 10, padding: "4px 8px", maxWidth: 120 }}
        />
        <input
          value={newNote}
          onChange={e => setNewNote(e.target.value)}
          placeholder="What was discussed / agreed..."
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          style={{ ...inputStyle, fontSize: 10, padding: "4px 8px", flex: 1 }}
        />
        <Btn onClick={handleAdd} color={T.blue} small disabled={!newNote.trim()}>LOG</Btn>
      </div>
      {visible.map(c => (
        <div key={c.id} style={{
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
          padding: "4px 8px", marginBottom: 2, background: T.inputBg, borderRadius: 3, fontSize: 10, fontFamily: T.font,
        }}>
          <div style={{ flex: 1 }}>
            <span style={{ color: T.textDim }}>
              {new Date(c.timestamp).toLocaleDateString()} {new Date(c.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
            {c.spokeTo && <span style={{ color: T.blue, marginLeft: 6 }}>{c.spokeTo}</span>}
            <div style={{ color: T.text, marginTop: 2 }}>{c.note}</div>
          </div>
          <button onClick={() => handleDelete(c.id)} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 12, padding: "0 4px" }}>&times;</button>
        </div>
      ))}
      {contacts.length > 3 && (
        <span onClick={() => setShowAll(!showAll)} style={{ color: T.blue, fontSize: 9, cursor: "pointer", fontFamily: T.font }}>
          {showAll ? "Show less" : `Show all ${contacts.length} entries`}
        </span>
      )}
      {shopName && contacts.length === 0 && (
        <div style={{ color: T.textDim, fontSize: 9, fontFamily: T.font }}>No contact history for this shop yet.</div>
      )}
    </div>
  );
}

// ─── Follow-Up Toast Notifications ──────────────────────────────
function FollowUpToasts({ onGoToClaim }) {
  const [alerts, setAlerts] = useState([]);
  const dismissedRef = useRef(new Set());

  useEffect(() => {
    const check = () => {
      const templates = getTemplates();
      const now = Date.now();
      const expired = templates.filter(t =>
        t.followUpAt &&
        new Date(t.followUpAt).getTime() <= now &&
        t.status !== "completed" &&
        !dismissedRef.current.has(t.id)
      );
      setAlerts(expired);
    };
    check();
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, []);

  const dismiss = (claimId) => {
    dismissedRef.current.add(claimId);
    setAlerts(prev => prev.filter(a => a.id !== claimId));
  };

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    if (alerts.length === 0) return;
    const timers = alerts.map(a =>
      setTimeout(() => dismiss(a.id), 30000)
    );
    return () => timers.forEach(clearTimeout);
  }, [alerts.map(a => a.id).join(",")]);

  if (alerts.length === 0) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, zIndex: 1000,
      display: "flex", flexDirection: "column", gap: 8, maxWidth: 340,
    }}>
      {alerts.slice(0, 3).map((claim) => (
        <div key={claim.id} style={{
          background: T.cardBg, border: `1px solid ${T.danger}55`,
          borderLeft: `4px solid ${T.danger}`,
          borderRadius: 8, padding: "12px 14px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          animation: "slideIn 0.3s ease-out",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div>
              <div style={{ color: T.danger, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, fontFamily: T.font, marginBottom: 2 }}>
                FOLLOW UP NOW
              </div>
              <div style={{ color: T.text, fontSize: 12, fontWeight: 600, fontFamily: T.font }}>
                {claim.claimNumber || "No Claim #"}
              </div>
              <div style={{ color: T.textDim, fontSize: 10, fontFamily: T.font }}>
                {claim.shopName || "No Shop"}
              </div>
            </div>
            <button onClick={() => dismiss(claim.id)} style={{
              background: "none", border: "none", color: T.textDim,
              cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1,
            }}>&times;</button>
          </div>
          {claim.followUpNote && (
            <div style={{
              color: T.text, fontSize: 10, fontFamily: T.font,
              background: T.inputBg, padding: "4px 8px", borderRadius: 3,
              marginBottom: 6, lineHeight: 1.4,
            }}>
              {claim.followUpNote}
            </div>
          )}
          <button onClick={() => { onGoToClaim(claim); dismiss(claim.id); }} style={{
            background: `${T.accent}18`, border: `1px solid ${T.accent}44`,
            color: T.accent, fontSize: 9, fontWeight: 600, letterSpacing: 1,
            fontFamily: T.font, padding: "5px 14px", borderRadius: 4,
            cursor: "pointer", width: "100%",
          }}>GO TO CLAIM</button>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("home");
  // Multi-claim tabs: array of { form, aiFields, label }
  const [claims, setClaims] = useState([{ form: createEmpty(), aiFields: [] }]);
  const [activeClaimIdx, setActiveClaimIdx] = useState(0);
  const previewRef = useRef(null);
  const [dupWarning, setDupWarning] = useState(null);
  const [shopPrompt, setShopPrompt] = useState(null); // { type, message, data }
  const shopPromptDismissed = useRef(new Set()); // track dismissed prompts per session

  // Seed rate database with default shops on first load
  useEffect(() => {
    const SEED_KEY = "hst-shops-seeded";
    if (localStorage.getItem(SEED_KEY)) return;
    const seeded = DEFAULT_SHOPS.map(s => ({ ...s, importedAt: new Date().toISOString(), source: "Default shop list" }));
    addRates(seeded); // merges with existing, won't duplicate
    localStorage.setItem(SEED_KEY, "1");
  }, []);

  // Current claim shortcut
  const form = claims[activeClaimIdx]?.form || createEmpty();
  const aiFields = claims[activeClaimIdx]?.aiFields || [];

  const setForm = useCallback((valOrFn) => {
    setClaims(prev => {
      const next = [...prev];
      const current = next[activeClaimIdx];
      if (!current) return prev;
      const newForm = typeof valOrFn === "function" ? valOrFn(current.form) : valOrFn;
      next[activeClaimIdx] = { ...current, form: newForm };
      return next;
    });
  }, [activeClaimIdx]);

  const setAiFields = useCallback((val) => {
    setClaims(prev => {
      const next = [...prev];
      if (next[activeClaimIdx]) next[activeClaimIdx] = { ...next[activeClaimIdx], aiFields: val };
      return next;
    });
  }, [activeClaimIdx]);

  // Update a nested field by dot-path
  const set = useCallback((path, val) => {
    setForm(prev => {
      const next = { ...prev };
      const parts = path.split(".");
      if (parts.length === 1) {
        next[parts[0]] = val;
      } else if (parts.length === 2) {
        next[parts[0]] = { ...next[parts[0]], [parts[1]]: val };
      }
      return next;
    });
  }, [setForm]);

  // Duplicate claim detection
  useEffect(() => {
    if (!form.claimNumber || form.claimNumber.length < 5) {
      setDupWarning(null);
      return;
    }
    const saved = getTemplates();
    const match = saved.find(t => t.claimNumber === form.claimNumber && t.id !== form.id);
    if (match) {
      setDupWarning({
        claim: match.claimNumber,
        shop: match.shopName,
        date: match.createdAt ? new Date(match.createdAt).toLocaleDateString() : "",
        id: match.id,
      });
    } else {
      setDupWarning(null);
    }
  }, [form.claimNumber, form.id]);

  // ── Auto-fill shop fields from rate database ────────────────
  const lastAutoFilledShop = useRef("");
  useEffect(() => {
    if (!form.shopName || form.shopName.length < 3) return;
    if (lastAutoFilledShop.current === form.shopName.toLowerCase()) return;
    const rateDb = getRates();
    const match = lookupShopRate(form.shopName, rateDb);
    if (!match) return;
    lastAutoFilledShop.current = form.shopName.toLowerCase();
    setForm(prev => {
      const updates = {};
      if (!prev.shopEmail && match.email) updates.shopEmail = match.email;
      if (!prev.shopPhone && match.phone) updates.shopPhone = match.phone;
      if (!prev.shopAddress && match.address) updates.shopAddress = match.address;
      if (!prev.shopCity && match.city) updates.shopCity = match.city;
      if (!prev.shopLicense && match.license) updates.shopLicense = match.license;
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [form.shopName]);

  // ── Auto-fill contact person from most recent shop contact ──
  const lastAutoFilledContact = useRef("");
  useEffect(() => {
    if (!form.shopName || form.shopName.length < 3) return;
    if (form.contact.contactPerson) return;
    if (lastAutoFilledContact.current === form.shopName.toLowerCase()) return;
    lastAutoFilledContact.current = form.shopName.toLowerCase();
    const contacts = getShopContactsByName(form.shopName);
    if (contacts.length === 0) return;
    const mostRecent = contacts[0];
    if (mostRecent.spokeTo) {
      set("contact.contactPerson", mostRecent.spokeTo);
    }
  }, [form.shopName, form.contact.contactPerson]);

  // ── Auto-calc mitigation cut-off when TL date changes ──────
  useEffect(() => {
    if (!form.tlDate) return;
    const cutoff = calcMitigationCutoff(form.tlDate);
    if (!cutoff) return;
    setForm(prev => {
      if (prev.mitigation.cutOffDate) return prev;
      return {
        ...prev,
        mitigation: {
          ...prev.mitigation,
          cutOffDate: cutoff,
          cutOffExplanation: prev.mitigation.cutOffExplanation || `3 days post-TL notice on ${formatMMDD(form.tlDate)}`,
        },
      };
    });
  }, [form.tlDate]);

  // ── Auto-fill storage coverage dates from key dates + mitigation ──
  useEffect(() => {
    setForm(prev => {
      const updates = {};
      if (prev.storageStartDate && !prev.audit.storageStartDate) {
        updates.storageStartDate = formatMMDD(prev.storageStartDate);
      }
      if (prev.mitigation.cutOffDate && !prev.audit.storageEndDate) {
        updates.storageEndDate = formatMMDD(prev.mitigation.cutOffDate);
      }
      const startStr = updates.storageStartDate || prev.audit.storageStartDate;
      const endStr = updates.storageEndDate || prev.audit.storageEndDate;
      if (startStr && endStr && !prev.audit.approvedStorageDays) {
        const days = daysBetween(prev.storageStartDate || startStr, prev.mitigation.cutOffDate || endStr);
        if (days > 0) updates.approvedStorageDays = days;
      }
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, audit: { ...prev.audit, ...updates } };
    });
  }, [form.storageStartDate, form.mitigation.cutOffDate]);

  // ── Auto-generate contact narrative when data is ready ──────
  const narrativeGenerated = useRef(false);
  useEffect(() => {
    if (narrativeGenerated.current) return;
    if (!form.shopName || !form.contact.contactPerson) return;
    if (form.contact.narrative) return;
    if (!form.audit.approvedStorageRate) return;
    narrativeGenerated.current = true;
    const narrative = generateContactNarrative(form);
    set("contact.narrative", narrative);
  }, [form.shopName, form.contact.contactPerson, form.audit.approvedStorageRate]);

  // Reset auto-fill refs when form is cleared
  useEffect(() => {
    if (!form.shopName && !form.claimNumber) {
      narrativeGenerated.current = false;
      lastAutoFilledShop.current = "";
      lastAutoFilledContact.current = "";
    }
  }, [form.shopName, form.claimNumber]);

  // ── Auto-default CSA time to CA timezone ────────────────────
  useEffect(() => {
    if (form.resolution.csaTime) return;
    if (!form.resolution.approvedCharges) return;
    const caTime = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: true });
    set("resolution.csaTime", caTime);
  }, [form.resolution.approvedCharges]);

  // Shop database prompts — watch for new/updated shop info
  useEffect(() => {
    if (!form.shopName || form.shopName.length < 3) { setShopPrompt(null); return; }
    const rateDb = getRates();
    const existing = rateDb.find(r => r.shopName.toLowerCase() === form.shopName.toLowerCase());
    const key = `shop-${form.shopName.toLowerCase()}`;
    if (!existing && !shopPromptDismissed.current.has(key)) {
      setShopPrompt({ type: "new-shop", message: `"${form.shopName}" isn't in your shop list. Add it?`, data: { shopName: form.shopName } });
      return;
    }
    if (existing) {
      // Check if rate changed
      const rateKey = `rate-${form.shopName.toLowerCase()}-${form.audit.approvedStorageRate}`;
      if (form.audit.approvedStorageRate && parseFloat(form.audit.approvedStorageRate) > 0 &&
          parseFloat(form.audit.approvedStorageRate) !== parseFloat(existing.marketRate) &&
          !shopPromptDismissed.current.has(rateKey)) {
        setShopPrompt({ type: "update-rate", message: `Update ${form.shopName}'s rate to $${form.audit.approvedStorageRate}/day?`, data: { shopName: form.shopName, marketRate: form.audit.approvedStorageRate } });
        return;
      }
      // Check if email is new/different
      const emailKey = `email-${form.shopName.toLowerCase()}-${form.shopEmail}`;
      if (form.shopEmail && form.shopEmail !== existing.email && !shopPromptDismissed.current.has(emailKey)) {
        setShopPrompt({ type: "update-email", message: `Save ${form.shopEmail} to ${form.shopName}'s record?`, data: { shopName: form.shopName, email: form.shopEmail } });
        return;
      }
      // Check if phone is new/different
      const phoneKey = `phone-${form.shopName.toLowerCase()}-${form.shopPhone}`;
      if (form.shopPhone && form.shopPhone !== existing.phone && !shopPromptDismissed.current.has(phoneKey)) {
        setShopPrompt({ type: "update-phone", message: `Save phone ${form.shopPhone} to ${form.shopName}'s record?`, data: { shopName: form.shopName, phone: form.shopPhone } });
        return;
      }
    }
    setShopPrompt(null);
  }, [form.shopName, form.shopEmail, form.shopPhone, form.audit.approvedStorageRate]);

  const handleShopPromptAccept = () => {
    if (!shopPrompt) return;
    const rateDb = getRates();
    const { type, data } = shopPrompt;
    if (type === "new-shop") {
      addRates([{
        shopName: data.shopName,
        marketRate: form.audit.approvedStorageRate || 0,
        email: form.shopEmail || "",
        phone: form.shopPhone || "",
        address: form.shopAddress || "",
        city: form.shopCity || "",
      }]);
    } else if (type === "update-rate") {
      addRates([{ shopName: data.shopName, marketRate: parseFloat(data.marketRate) }]);
    } else if (type === "update-email") {
      addRates([{ shopName: data.shopName, email: data.email }]);
    } else if (type === "update-phone") {
      addRates([{ shopName: data.shopName, phone: data.phone }]);
    }
    setShopPrompt(null);
  };

  const handleShopPromptDismiss = () => {
    if (!shopPrompt) return;
    const { type, data } = shopPrompt;
    let key = "";
    if (type === "new-shop") key = `shop-${data.shopName.toLowerCase()}`;
    else if (type === "update-rate") key = `rate-${data.shopName.toLowerCase()}-${data.marketRate}`;
    else if (type === "update-email") key = `email-${data.shopName.toLowerCase()}-${data.email}`;
    else if (type === "update-phone") key = `phone-${data.shopName.toLowerCase()}-${data.phone}`;
    shopPromptDismissed.current.add(key);
    setShopPrompt(null);
  };

  // Multi-claim: add new claim tab
  const addClaimTab = () => {
    setClaims(prev => [...prev, { form: createEmpty(), aiFields: [] }]);
    setActiveClaimIdx(claims.length);
  };

  // Multi-claim: close claim tab
  const closeClaimTab = (idx) => {
    if (claims.length <= 1) return; // keep at least one
    setClaims(prev => prev.filter((_, i) => i !== idx));
    if (activeClaimIdx >= idx && activeClaimIdx > 0) {
      setActiveClaimIdx(activeClaimIdx - 1);
    }
  };

  // Auto-save drafts to sessionStorage every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      try { sessionStorage.setItem("hst-autosave", JSON.stringify(claims)); } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [claims]);

  // Restore auto-save on mount
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("hst-autosave");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].form) {
          setClaims(parsed);
        }
      }
    } catch {}
  }, []);

  // Auto-calculations
  useEffect(() => {
    const audit = form.audit;
    const storageAmt = calcApprovedStorage(audit.approvedStorageRate, audit.approvedStorageDays);
    const totalApproved = storageAmt +
      (parseFloat(audit.approvedTow) || 0) +
      (parseFloat(audit.approvedTeardown) || 0) +
      (parseFloat(audit.approvedLabor) || 0) +
      (parseFloat(audit.approvedOther) || 0);
    const totalBilled = calcTotalBilled(form.charges);
    const disputed = totalBilled;
    const reductions = Math.max(0, totalBilled - totalApproved);
    setForm(prev => {
      const needsUpdate =
        prev.audit.approvedStorageAmount !== storageAmt ||
        prev.resolution.approvedCharges !== totalApproved ||
        prev.resolution.disputedCharges !== disputed ||
        prev.resolution.reductions !== reductions ||
        prev.resolution.dispatchAmount !== totalApproved;

      if (!needsUpdate) return prev;

      return {
        ...prev,
        audit: { ...prev.audit, approvedStorageAmount: storageAmt },
        resolution: {
          ...prev.resolution,
          approvedCharges: totalApproved,
          disputedCharges: disputed,
          reductions: reductions,
          dispatchAmount: totalApproved,
        },
      };
    });
  }, [form.charges, form.audit.approvedStorageRate, form.audit.approvedStorageDays, form.audit.approvedTow, form.audit.approvedTeardown, form.audit.approvedLabor, form.audit.approvedOther]);

  // Auto-populate denied fees list from charges
  useEffect(() => {
    const denied = form.charges
      .filter(c => c.autoDenied && c.amount > 0)
      .map(c => c.name);
    setForm(prev => {
      if (JSON.stringify(prev.audit.deniedFees) === JSON.stringify(denied)) return prev;
      return { ...prev, audit: { ...prev.audit, deniedFees: denied } };
    });
  }, [form.charges]);

  // ── Auto-approve charges based on charge type rules ─────────
  useEffect(() => {
    if (!form.charges || form.charges.length === 0) return;
    setForm(prev => {
      const updates = {};
      const noteUpdates = {};
      let towTotal = 0, teardownTotal = 0, laborTotal = 0, otherTotal = 0;
      let towNotes = [], teardownNotes = [], laborNotes = [], otherNotes = [];

      for (const charge of prev.charges) {
        if (charge.autoDenied || !charge.amount || charge.amount <= 0) continue;
        const lower = charge.name.toLowerCase();
        const defaultAmt = getDefaultAmount(charge.name);

        // Determine approved amount
        let approved;
        if (defaultAmt === "billed") {
          approved = charge.amount; // approve at billed price (tow, lien)
        } else if (typeof defaultAmt === "number") {
          approved = defaultAmt; // fixed rate (dolly $250, cleanup $250, pre-scan $65, extra equipment $250)
        } else {
          approved = charge.amount; // non-denied charges without rules: approve as billed
        }

        // Route to correct audit field
        const normalized = lower.replace(/\s+/g, "");
        if (normalized.includes("tow") || lower === "advance tow") {
          towTotal += approved;
          towNotes.push(defaultAmt === "billed" ? "Approved as billed" : charge.name);
        } else if (normalized.includes("teardown") || lower.includes("tear down")) {
          teardownTotal += approved;
          teardownNotes.push("Approved as billed");
        } else if (lower.includes("labor")) {
          laborTotal += approved;
          laborNotes.push("Approved as billed");
        } else if (lower === "storage") {
          // Storage handled separately by rate × days
          continue;
        } else {
          // Everything else goes to "Other" (dolly, cleanup, pre-scan, lien, extra equipment, etc.)
          otherTotal += approved;
          if (defaultAmt === "billed") {
            otherNotes.push(`${charge.name}: approved as billed`);
          } else if (typeof defaultAmt === "number") {
            otherNotes.push(`${charge.name}: $${defaultAmt}`);
          } else {
            otherNotes.push(`${charge.name}: approved as billed`);
          }
        }
      }

      // Only update if values actually changed
      const auditUpdates = {};
      if (towTotal > 0 && prev.audit.approvedTow !== towTotal) {
        auditUpdates.approvedTow = towTotal;
        auditUpdates.towNote = towNotes.join(", ");
      }
      if (teardownTotal > 0 && prev.audit.approvedTeardown !== teardownTotal) {
        auditUpdates.approvedTeardown = teardownTotal;
        auditUpdates.teardownNote = teardownNotes.join(", ");
      }
      if (laborTotal > 0 && prev.audit.approvedLabor !== laborTotal) {
        auditUpdates.approvedLabor = laborTotal;
        auditUpdates.laborNote = laborNotes.join(", ");
      }
      if (otherTotal > 0 && prev.audit.approvedOther !== otherTotal) {
        auditUpdates.approvedOther = otherTotal;
        auditUpdates.otherNote = otherNotes.join("; ");
      }

      if (Object.keys(auditUpdates).length === 0) return prev;
      return { ...prev, audit: { ...prev.audit, ...auditUpdates } };
    });
  }, [form.charges]);

  // Handle AI parse result
  const handleParsed = (parsed, rawText) => {
    const filled = [];
    const next = { ...createEmpty(), rawPastedData: rawText };

    // Map parsed fields
    const map = {
      claimNumber: "claimNumber", iaaStock: "iaaStock",
      vehicleYear: "vehicleYear", vehicleMake: "vehicleMake", vehicleModel: "vehicleModel",
      vin: "vin", shopName: "shopName", shopAlias: "shopAlias",
      shopAddress: "shopAddress", shopCity: "shopCity", shopPhone: "shopPhone",
      shopLicense: "shopLicense", shopEmail: "shopEmail",
      chargesBilledThrough: "chargesBilledThrough",
      insuredName: "insuredName", adjusterName: "adjusterName",
      lossDescription: "lossDescription", tlDate: "tlDate",
      storageStartDate: "storageStartDate", claimReportDate: "claimReportDate",
    };

    for (const [src, dst] of Object.entries(map)) {
      if (parsed[src]) {
        next[dst] = parsed[src];
        filled.push(dst);
      }
    }

    // Charges
    if (parsed.charges?.length) {
      next.charges = parsed.charges.map(c => ({
        id: crypto.randomUUID(),
        name: c.name || "",
        amount: parseFloat(c.amount) || 0,
        rate: parseFloat(c.rate) || 0,
        days: parseInt(c.days) || 0,
        startDate: c.startDate || "",
        endDate: c.endDate || "",
        description: c.description || "",
        autoDenied: isChargeDenied(c.name || ""),
      }));
      filled.push("charges");
    }

    // File review
    if (parsed.fileReview?.length) {
      next.fileReview = parsed.fileReview.map(e => ({ date: e.date || "", event: e.event || "" }));
      filled.push("fileReview");
    }

    // Mitigation
    if (parsed.mitigation) {
      next.mitigation = { ...next.mitigation, ...parsed.mitigation };
      filled.push("mitigation");
    }

    // Contact person
    if (parsed.contactPerson) {
      next.contact.contactPerson = parsed.contactPerson;
      filled.push("contactPerson");
    }

    // Auto-apply rules: mitigation cutoff
    if (next.tlDate && !next.mitigation.cutOffDate) {
      next.mitigation.cutOffDate = calcMitigationCutoff(next.tlDate);
      next.mitigation.cutOffExplanation = `3 days post-TL notice on ${formatMMDD(next.tlDate)}`;
    }

    // Auto-apply: market rate lookup
    const rateDb = getRates();
    const shopRate = lookupShopRate(next.shopName, rateDb);
    if (shopRate) {
      next.audit.approvedStorageRate = shopRate.marketRate;
    } else if (next.shopCity) {
      next.audit.approvedStorageRate = getDefaultMarketRate(next.shopCity, "CA");
    }

    // Auto-apply: storage date range
    if (next.storageStartDate) {
      next.audit.storageStartDate = formatMMDD(next.storageStartDate);
    }
    if (next.mitigation.cutOffDate) {
      next.audit.storageEndDate = formatMMDD(next.mitigation.cutOffDate);
    }

    // Storage days
    if (next.audit.storageStartDate && next.audit.storageEndDate) {
      next.audit.approvedStorageDays = daysBetween(next.storageStartDate, next.mitigation.cutOffDate);
    }

    setForm(next);
    setAiFields(filled);
  };

  // Save
  const handleSave = (overrideStatus) => {
    const toSave = {
      ...form,
      id: form.id || crypto.randomUUID(),
      status: overrideStatus || form.status || "pending",
      generatedTemplate: generateTemplate(form),
      generatedEmail: generateShopEmail(form),
    };
    saveTemplate(toSave);
    setForm(prev => ({ ...prev, id: toSave.id, status: toSave.status }));
  };

  // Load from history — loads into the current claim tab
  const handleLoad = (t) => {
    setForm(t);
    setAiFields([]);
    setTab("new");
  };

  // Reset current claim tab
  const handleNew = () => {
    setForm(createEmpty());
    setAiFields([]);
  };

  // Generate narrative
  const handleGenNarrative = () => {
    const narrative = generateContactNarrative(form);
    set("contact.narrative", narrative);
  };

  // Voice input for narrative
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef(null);
  const micStoppingRef = useRef(false);
  const handleMic = () => {
    if (isRecording && recognitionRef.current) {
      micStoppingRef.current = true;
      recognitionRef.current.stop();
      return;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Speech recognition not supported in this browser."); return; }
    micStoppingRef.current = false;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognitionRef.current = recognition;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript) {
        transcript = transcript.trim();
        transcript = transcript.charAt(0).toUpperCase() + transcript.slice(1);
        transcript = transcript.replace(/\.\s*([a-z])/g, (_, c) => `. ${c.toUpperCase()}`);
        if (!/[.!?]$/.test(transcript)) transcript += ".";
        set("contact.narrative", (form.contact.narrative ? form.contact.narrative + " " : "") + transcript);
      }
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        alert("Microphone access denied. Please allow mic permissions.");
      }
      micStoppingRef.current = true;
      setIsRecording(false);
    };
    recognition.onend = () => {
      // Auto-restart unless user clicked STOP
      if (!micStoppingRef.current) {
        try { recognition.start(); } catch { setIsRecording(false); }
      } else {
        setIsRecording(false);
      }
    };
    setIsRecording(true);
    recognition.start();
  };

  const TABS = [
    { key: "home", label: "Home" },
    { key: "new", label: "New Template" },
    { key: "history", label: "History" },
    { key: "rates", label: "Rate Database" },
    { key: "settings", label: "Settings" },
  ];

  const aiBadge = (field) => aiFields.includes(field) ? "AI" : null;
  const lateNotif = isLateNotification(form.storageStartDate, form.claimReportDate);

  return (
    <div style={{ background: T.bg, minHeight: "100vh", color: T.text, fontFamily: T.font }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(224,85,85,0); } 50% { box-shadow: 0 0 8px 2px rgba(224,85,85,0.3); } }
      `}</style>
      <FollowUpToasts onGoToClaim={(claim) => { handleLoad(claim); }} />
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px", background: T.cardBg, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: T.text, fontSize: 16, fontWeight: 700, letterSpacing: 2 }}>HST Command</div>
          <div style={{ color: T.textMuted, fontSize: 9, letterSpacing: 1.5, marginTop: 2 }}>High Storage Template Generator</div>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: tab === t.key ? `${T.accent}14` : "none",
                border: `1px solid ${tab === t.key ? T.accent + "44" : "transparent"}`,
                color: tab === t.key ? T.text : T.textDim,
                padding: "7px 16px",
                borderRadius: 6,
                cursor: "pointer",
                fontFamily: T.font,
                fontSize: 11,
                fontWeight: tab === t.key ? 500 : 400,
                letterSpacing: 0.3,
                transition: "all 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: 16 }}>
        {/* ─── HOME DASHBOARD ─── */}
        {tab === "home" && (
          <HomeDashboard
            onNewClaim={() => { handleNew(); setTab("new"); }}
            onLoadClaim={(t) => { handleLoad(t); }}
            onUpdateStatus={(id, status) => {
              // If this is the currently loaded claim, update it in-form too
              if (form.id === id) set("status", status);
            }}
          />
        )}

        {/* ─── NEW TEMPLATE TAB ─── */}
        {tab === "new" && (
          <div>
            {/* Multi-claim tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10, alignItems: "center" }}>
              {claims.map((c, idx) => (
                <div
                  key={idx}
                  onClick={() => setActiveClaimIdx(idx)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "4px 10px",
                    background: idx === activeClaimIdx ? `${T.accent}14` : "transparent",
                    border: `1px solid ${idx === activeClaimIdx ? T.accent + "44" : T.border}`,
                    borderRadius: 6, cursor: "pointer",
                  }}
                >
                  <span style={{ color: idx === activeClaimIdx ? T.text : T.textDim, fontSize: 10, fontFamily: T.font, fontWeight: idx === activeClaimIdx ? 500 : 400 }}>
                    {c.form.shopName || `CLAIM ${idx + 1}`}
                  </span>
                  {claims.length > 1 && (
                    <span
                      onClick={e => { e.stopPropagation(); closeClaimTab(idx); }}
                      style={{ color: T.textDim, fontSize: 10, cursor: "pointer", marginLeft: 2, lineHeight: 1 }}
                    >&times;</span>
                  )}
                </div>
              ))}
              <span
                onClick={addClaimTab}
                style={{
                  color: T.textDim, fontSize: 14, cursor: "pointer",
                  padding: "2px 8px", border: `1px dashed ${T.border}`, borderRadius: 4,
                  lineHeight: 1,
                }}
                title="Open new claim tab"
              >+</span>
            </div>

            <FollowUpTimer form={form} onSetField={set} />

            <PastePanel onParsed={handleParsed} storedRaw={form.rawPastedData} />

            {/* Duplicate claim warning */}
            {dupWarning && (
              <div style={{ background: `${T.amber}15`, border: `1px solid ${T.amber}44`, borderRadius: 6, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: T.amber, fontSize: 14 }}>⚠</span>
                  <span style={{ color: T.amber, fontSize: 11, fontFamily: T.font }}>
                    DUPLICATE: Claim {dupWarning.claim} was already completed for {dupWarning.shop || "unknown shop"} on {dupWarning.date}
                  </span>
                </div>
                <Btn onClick={() => { const t = getTemplates().find(t => t.id === dupWarning.id); if (t) handleLoad(t); }} color={T.amber} small>LOAD IT</Btn>
              </div>
            )}

            {lateNotif && (
              <div style={{ background: `${T.orange}15`, border: `1px solid ${T.orange}44`, borderRadius: 6, padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: T.orange, fontSize: 14 }}>!</span>
                <span style={{ color: T.orange, fontSize: 11, fontFamily: T.font }}>
                  LATE NOTIFICATION: Vehicle arrived {daysBetween(form.storageStartDate, form.claimReportDate)} days before claim was filed. Storage may start at Date of Notice.
                </span>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
              {/* LEFT: Form */}
              <div>
                {/* Claim Info */}
                <Section title="CLAIM INFO" accent={T.accent} badge={aiBadge("claimNumber")}>
                  <Row>
                    <Input label="Claim Number" value={form.claimNumber} onChange={v => set("claimNumber", v)} />
                    <Input label="IAA Stock" value={form.iaaStock} onChange={v => set("iaaStock", v)} />
                  </Row>
                  <Row>
                    <Input label="Year" value={form.vehicleYear} onChange={v => set("vehicleYear", v)} small style={{ maxWidth: 70 }} />
                    <Input label="Make" value={form.vehicleMake} onChange={v => set("vehicleMake", v)} />
                    <Input label="Model" value={form.vehicleModel} onChange={v => set("vehicleModel", v)} />
                  </Row>
                  <Row>
                    <Input label="VIN" value={form.vin} onChange={v => set("vin", v)} />
                  </Row>
                  <Row>
                    <Input label="Insured Name" value={form.insuredName} onChange={v => set("insuredName", v)} />
                    <Input label="Adjuster" value={form.adjusterName} onChange={v => set("adjusterName", v)} />
                  </Row>
                </Section>

                {/* Shop Info */}
                <Section title="SHOP / TOW YARD" accent={T.accent} badge={aiBadge("shopName")}>
                  <Row>
                    <Input label="Shop Name" value={form.shopName} onChange={v => set("shopName", v)} />
                    <Input label="Alias (aka)" value={form.shopAlias} onChange={v => set("shopAlias", v)} />
                  </Row>
                  <Row>
                    <Input label="Address" value={form.shopAddress} onChange={v => set("shopAddress", v)} />
                  </Row>
                  <Row>
                    <Input label="City" value={form.shopCity} onChange={v => set("shopCity", v)} />
                    <Input label="Phone" value={form.shopPhone} onChange={v => set("shopPhone", v)} />
                  </Row>
                  <Row>
                    <Input label="License" value={form.shopLicense} onChange={v => set("shopLicense", v)} placeholder="e.g. valid 313676" />
                    <Input label="Email" value={form.shopEmail} onChange={v => set("shopEmail", v)} />
                  </Row>
                  {shopPrompt && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", marginTop: 8, background: `${T.accent}15`, border: `1px solid ${T.accent}40`, borderRadius: 6 }}>
                      <span style={{ flex: 1, color: T.text, fontSize: 12, fontFamily: T.font }}>{shopPrompt.message}</span>
                      <Btn onClick={handleShopPromptAccept} color={T.accent} small>YES</Btn>
                      <Btn onClick={handleShopPromptDismiss} color={T.textDim} small>NO</Btn>
                    </div>
                  )}
                  <ShopReputationBadge shopName={form.shopName} />
                </Section>

                {/* Charges */}
                <Section title="SHOP CHARGES" accent={T.accent} badge={aiBadge("charges")}>
                  <ChargesEditor
                    charges={form.charges}
                    onChange={v => set("charges", v)}
                    billedThrough={form.chargesBilledThrough}
                    onBilledThroughChange={v => set("chargesBilledThrough", v)}
                  />
                </Section>

                {/* Key Dates */}
                <Section title="KEY DATES" accent={T.accent} defaultOpen={true}>
                  <Row>
                    <Input label="Storage Start (Arrival)" value={form.storageStartDate} onChange={v => set("storageStartDate", v)} placeholder="MM/DD/YYYY" />
                    <Input label="Claim Reported" value={form.claimReportDate} onChange={v => set("claimReportDate", v)} placeholder="MM/DD/YYYY" />
                  </Row>
                  <Row>
                    <Input label="Total Loss Date" value={form.tlDate} onChange={v => set("tlDate", v)} placeholder="MM/DD/YYYY" />
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Auto Cut-Off (3 Biz Days)</label>
                      <div style={{ color: T.text, fontSize: 12, fontFamily: T.font, padding: "8px 0" }}>
                        {form.tlDate ? calcMitigationCutoff(form.tlDate) : "Enter TL date"}
                      </div>
                    </div>
                  </Row>
                </Section>

                {/* File Review */}
                <Section title="FILE REVIEW" accent={T.accent} defaultOpen={false} badge={aiBadge("fileReview")}>
                  <FileReviewEditor entries={form.fileReview} onChange={v => set("fileReview", v)} rawText={form.rawPastedData} />
                </Section>

                {/* Mitigation */}
                <Section title="MITIGATION / CUT-OFF" accent={T.accent} badge={aiBadge("mitigation")}>
                  <Row>
                    <Input label="Sent By" value={form.mitigation.sentBy} onChange={v => set("mitigation.sentBy", v)} />
                    <Input label="Role" value={form.mitigation.sentByRole} onChange={v => set("mitigation.sentByRole", v)} placeholder="PA, AL, Adj" small style={{ maxWidth: 80 }} />
                  </Row>
                  <Row>
                    <Input label="Date Sent" value={form.mitigation.sentDate} onChange={v => set("mitigation.sentDate", v)} placeholder="MM/DD/YYYY" />
                    <Input label="Cut-Off Date" value={form.mitigation.cutOffDate} onChange={v => set("mitigation.cutOffDate", v)} placeholder="MM/DD/YYYY" />
                  </Row>
                  <Row>
                    <Input label="Explanation" value={form.mitigation.cutOffExplanation} onChange={v => set("mitigation.cutOffExplanation", v)} placeholder="e.g. 3 days post-TL notice on 03/02" />
                  </Row>
                  {form.tlDate && !form.mitigation.cutOffDate && (
                    <Btn onClick={() => {
                      const cutoff = calcMitigationCutoff(form.tlDate);
                      set("mitigation.cutOffDate", cutoff);
                      set("mitigation.cutOffExplanation", `3 days post-TL notice on ${formatMMDD(form.tlDate)}`);
                    }} color={T.orange} small>AUTO-CALC CUT-OFF</Btn>
                  )}
                </Section>

                {/* HST Audit */}
                <Section title="KEMPER COVERAGE (HST AUDIT)" accent={T.accent}>
                  <Row>
                    <Input label="Approved Rate/Day" value={form.audit.approvedStorageRate} onChange={v => set("audit.approvedStorageRate", v)} type="number" />
                    <Input label="Approved Days" value={form.audit.approvedStorageDays} onChange={v => set("audit.approvedStorageDays", v)} type="number" />
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Storage Total</label>
                      <div style={{ color: T.text, fontSize: 13, fontFamily: T.font, padding: "8px 0", fontWeight: 600 }}>
                        {fmtDollar(calcApprovedStorage(form.audit.approvedStorageRate, form.audit.approvedStorageDays))}
                      </div>
                    </div>
                  </Row>
                  <Row>
                    <Input label="Coverage Start" value={form.audit.storageStartDate} onChange={v => set("audit.storageStartDate", v)} placeholder="MM/DD" />
                    <Input label="Coverage End" value={form.audit.storageEndDate} onChange={v => set("audit.storageEndDate", v)} placeholder="MM/DD" />
                  </Row>
                  <Row>
                    <Input label="Approved Tow" value={form.audit.approvedTow} onChange={v => set("audit.approvedTow", v)} type="number" />
                    <Input label="Tow Note" value={form.audit.towNote} onChange={v => set("audit.towNote", v)} placeholder="Approved as billed" />
                  </Row>
                  <Row>
                    <Input label="Approved Teardown" value={form.audit.approvedTeardown} onChange={v => set("audit.approvedTeardown", v)} type="number" />
                    <Input label="Teardown Note" value={form.audit.teardownNote} onChange={v => set("audit.teardownNote", v)} placeholder="" />
                  </Row>
                  <Row>
                    <Input label="Approved Labor" value={form.audit.approvedLabor} onChange={v => set("audit.approvedLabor", v)} type="number" />
                    <Input label="Labor Note" value={form.audit.laborNote} onChange={v => set("audit.laborNote", v)} placeholder="" />
                  </Row>
                  <Row>
                    <Input label="Approved Other" value={form.audit.approvedOther} onChange={v => set("audit.approvedOther", v)} type="number" />
                    <Input label="Other Note" value={form.audit.otherNote} onChange={v => set("audit.otherNote", v)} placeholder="" />
                  </Row>
                  {/* Summary */}
                  <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 8, paddingTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: T.textDim, fontSize: 10, letterSpacing: 1 }}>DENIED FEES (AB-2392)</span>
                      <span style={{ color: T.red, fontSize: 11 }}>{form.audit.deniedFees?.join(", ") || "None"}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: T.textDim, fontSize: 10, letterSpacing: 1 }}>TOTAL APPROVED</span>
                      <span style={{ color: T.accent, fontSize: 14, fontWeight: 600 }}>{fmtDollar(form.resolution.approvedCharges)}</span>
                    </div>
                  </div>
                </Section>

                {/* Contact */}
                <Section title="CONTACT TO SHOP" accent={T.accent} defaultOpen={false}>
                  <Row>
                    <Input label="Contact Person" value={form.contact.contactPerson} onChange={v => set("contact.contactPerson", v)} />
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                      <Btn onClick={handleGenNarrative} color={T.blue} small>GENERATE</Btn>
                      <Btn onClick={handleMic} color={isRecording ? T.danger : T.accent} small style={isRecording ? { animation: "pulse 1s infinite" } : {}}>
                        {isRecording ? "STOP" : "MIC"}
                      </Btn>
                    </div>
                  </Row>
                  <TextArea label="Narrative" value={form.contact.narrative} onChange={v => set("contact.narrative", v)} rows={5} placeholder="Click GENERATE, use MIC to dictate, or write your own..." />
                  {form.shopName && <ShopContactLog shopName={form.shopName} />}
                </Section>

                {/* Resolution */}
                <Section title="RESOLUTION" accent={T.accent} defaultOpen={false}>
                  <Row>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Dispatch Amount</label>
                      <div style={{ color: T.text, fontSize: 14, fontFamily: T.font, padding: "8px 0", fontWeight: 600 }}>{fmtDollar(form.resolution.dispatchAmount)}</div>
                    </div>
                    <div style={{ flex: 1, display: "flex", gap: 4, alignItems: "flex-end" }}>
                      <Input label="CSA Time" value={form.resolution.csaTime} onChange={v => set("resolution.csaTime", v)} placeholder="10:45 AM" />
                      <Btn onClick={() => {
                        const fmt12 = (tz) => {
                          const s = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
                          return s;
                        };
                        set("resolution.csaTime", fmt12("America/Los_Angeles"));
                      }} color={T.purple} small style={{ whiteSpace: "nowrap", marginBottom: 1 }}>CA</Btn>
                      <Btn onClick={() => {
                        const fmt12 = (tz) => {
                          const s = new Date().toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
                          return s;
                        };
                        set("resolution.csaTime", fmt12("America/Phoenix"));
                      }} color={T.textDim} small style={{ whiteSpace: "nowrap", marginBottom: 1 }}>AZ</Btn>
                    </div>
                  </Row>
                  <Row>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Approved</label>
                      <div style={{ color: T.accent, fontSize: 12, fontFamily: T.font, padding: "4px 0" }}>{fmtDollar(form.resolution.approvedCharges)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Disputed</label>
                      <div style={{ color: T.red, fontSize: 12, fontFamily: T.font, padding: "4px 0" }}>{fmtDollar(form.resolution.disputedCharges)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Reductions</label>
                      <div style={{ color: T.warn, fontSize: 12, fontFamily: T.font, padding: "4px 0" }}>{fmtDollar(form.resolution.reductions)}</div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Input label="Deduction" value={form.resolution.deduction} onChange={v => set("resolution.deduction", parseFloat(v) || 0)} placeholder="0.00" />
                    </div>
                  </Row>
                  <Row>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Customer Notified</label>
                      <select value={form.resolution.customerNotified} onChange={e => set("resolution.customerNotified", e.target.value)} style={{ ...inputStyle, fontSize: 11 }}>
                        <option value="y">y</option>
                        <option value="n">n</option>
                        <option value="n/a">n/a</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Denial Letter</label>
                      <select value={form.resolution.denialLetterSent} onChange={e => set("resolution.denialLetterSent", e.target.value)} style={{ ...inputStyle, fontSize: 11 }}>
                        <option value="y">y</option>
                        <option value="n">n</option>
                        <option value="n/a">n/a</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Retained By</label>
                      <select value={form.resolution.ownerRetained} onChange={e => set("resolution.ownerRetained", e.target.value)} style={{ ...inputStyle, fontSize: 11 }}>
                        <option value="COMPANY">COMPANY</option>
                        <option value="OWNER">OWNER</option>
                      </select>
                    </div>
                  </Row>
                  <TextArea label="Comments" value={form.resolution.comments} onChange={v => set("resolution.comments", v)} rows={3} placeholder="Summary comments..." />
                </Section>
              </div>

              {/* RIGHT: Preview */}
              <div ref={previewRef} style={{ position: "sticky", top: 16, maxHeight: "calc(100vh - 100px)", overflow: "auto", display: "flex", flexDirection: "column" }}>
                <DualPreview form={form} onSetField={set} />
              </div>
            </div>

            {/* Urgent Pickup Note */}
            <UrgentPickupNote form={form} />

            {/* Action Bar */}
            <div style={{ display: "flex", gap: 10, marginTop: 16, padding: "14px 0", borderTop: `1px solid ${T.border}`, flexWrap: "wrap", alignItems: "center" }}>
              <Btn onClick={() => handleSave()} color={T.green}>SAVE</Btn>
              <div style={{ display: "flex", gap: 4, padding: "4px", background: T.inputBg, borderRadius: 6, border: `1px solid ${T.border}` }}>
                {CLAIM_STATUSES.map(s => (
                  <button key={s.key} onClick={() => { set("status", s.key); handleSave(s.key); setTab("home"); }} style={{
                    background: form.status === s.key ? `${s.color}22` : "none",
                    border: form.status === s.key ? `1px solid ${s.color}55` : "1px solid transparent",
                    color: form.status === s.key ? s.color : T.textDim,
                    fontSize: 9, fontFamily: T.font, fontWeight: 600, padding: "4px 10px",
                    borderRadius: 4, cursor: "pointer", letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{s.label}</button>
                ))}
              </div>
              <Btn onClick={handleNew} color={T.textDim}>NEW / CLEAR</Btn>
              {form.id && <span style={{ color: T.textDim, fontSize: 10, fontFamily: T.font, alignSelf: "center" }}>Saved: {form.id.slice(0, 8)}</span>}
            </div>
          </div>
        )}

        {/* ─── HISTORY TAB ─── */}
        {tab === "history" && <HistoryList onLoad={handleLoad} />}

        {/* ─── RATE DATABASE TAB ─── */}
        {tab === "rates" && <RateDatabaseView />}

        {/* ─── SETTINGS TAB ─── */}
        {tab === "settings" && <SettingsPanel />}
      </div>
    </div>
  );
}
