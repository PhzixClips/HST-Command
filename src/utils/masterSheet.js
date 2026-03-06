// Master Sheet utility — builds a row from claim data and copies to clipboard
// so you can click the first cell of an empty row in Excel and paste the whole line
// Columns match the master sheet:
// A: Claim#, B: Date, C: CV/IV, D: Carrier, E: Shop Name,
// F: Status, G: Open/Closed, H: Billed, I: Approved, J: Disputed,
// K: Total Approved, L: IAA Stock#, M: Completion Date, N: Days

import { calcTotalBilled, calcTotalApproved, calcDisputed } from "./calculations.js";

// Map form data to ordered array of cell values matching master sheet columns
export function buildMasterSheetRow(form) {
  const totalBilled = calcTotalBilled(form.charges || []);
  const totalApproved = calcTotalApproved(form.audit || {});
  const disputed = calcDisputed(totalBilled, totalApproved);
  const approvedCharges = form.resolution?.approvedCharges || totalApproved;

  // Determine negotiation status text
  let negotiationStatus = "OFFER SENT";
  const status = (form.status || "pending").toLowerCase();
  if (status === "completed") negotiationStatus = "NEGOTIATION COMPLETED";
  else if (status === "negotiating") negotiationStatus = "NEGOTIATION COMPLETED";
  else if (status === "escalated") negotiationStatus = "EXCEEDS LIMITS";

  // Open/Closed
  const openClosed = status === "completed" ? "CLOSED" : "Open";

  // Coverage type: default IV
  const coverageType = form.coverageType || "IV";

  // Carrier: default Infinity
  const carrier = form.carrier || "Infinity";

  // Date assigned (today if not set)
  const assignDate = form.createdAt
    ? new Date(form.createdAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
    : new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });

  // Completion date
  const completionDate = status === "completed"
    ? (form.updatedAt
      ? new Date(form.updatedAt).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" })
      : new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" }))
    : "";

  // Days between assignment and completion
  let days = "";
  if (status === "completed" && form.createdAt) {
    const start = new Date(form.createdAt);
    const end = form.updatedAt ? new Date(form.updatedAt) : new Date();
    days = Math.max(0, Math.round((end - start) / 86400000));
  }

  // Format currency values without $ sign for Excel
  const fmtNum = (n) => {
    const v = parseFloat(n) || 0;
    return v === 0 ? "$0.00" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Return ordered values matching master sheet columns A through N
  return [
    form.claimNumber || "",       // A: Claim #
    assignDate,                   // B: Date
    coverageType,                 // C: CV/IV
    carrier,                      // D: Carrier
    form.shopName || "",          // E: Shop Name
    negotiationStatus,            // F: Negotiation Status
    openClosed,                   // G: Open/Closed
    fmtNum(totalBilled),          // H: Billed
    fmtNum(approvedCharges),      // I: Approved
    fmtNum(disputed),             // J: Disputed
    fmtNum(totalApproved),        // K: Total Approved
    form.iaaStock || "",          // L: IAA Stock #
    completionDate,               // M: Completion Date
    days,                         // N: Days
  ];
}

// Copy master sheet row to clipboard as tab-separated values
// User can then click first cell of empty row in Excel and Ctrl+V
export async function copyMasterSheetRow(form) {
  const values = buildMasterSheetRow(form);
  const tsvLine = values.join("\t");

  try {
    await navigator.clipboard.writeText(tsvLine);
    return { success: true, values };
  } catch (e) {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = tsvLine;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return { success: true, values };
  }
}

// Also keep the Excel export option for full sheet download
export async function exportToMasterSheet(form) {
  const XLSX = await import("xlsx");
  const values = buildMasterSheetRow(form);
  const headers = ["Claim #", "Date", "CV/IV", "Carrier", "Shop Name", "Status", "Open/Closed", "Billed", "Approved", "Disputed", "Total Approved", "IAA Stock #", "Completion Date", "Days"];

  // Load existing rows from cache
  const cached = localStorage.getItem("hst-master-sheet-rows");
  let rows = cached ? JSON.parse(cached) : [];

  // Build row object
  const rowObj = {};
  headers.forEach((h, i) => { rowObj[h] = values[i]; });

  // Update or add
  const existingIdx = rows.findIndex(r => r["Claim #"] === rowObj["Claim #"] && r["Claim #"]);
  if (existingIdx >= 0) {
    rows[existingIdx] = rowObj;
  } else {
    rows.push(rowObj);
  }
  localStorage.setItem("hst-master-sheet-rows", JSON.stringify(rows));

  // Build workbook
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 14 }, { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 28 },
    { wch: 26 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 6 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, new Date().getFullYear().toString());
  XLSX.writeFile(wb, `HST_Master_Sheet_${new Date().toISOString().slice(0, 10)}.xlsx`);

  return rowObj;
}
