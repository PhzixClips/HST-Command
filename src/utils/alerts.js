// Smart Alerts: contextual notifications to speed up claim processing
import { daysBetween, parseDate } from "./dates.js";

// Alert levels: "warn" (orange), "info" (blue), "error" (red)
// Each alert: { level, title, message, key }

export function generateAlerts(form) {
  const alerts = [];

  // --- LATE NOTIFICATION ---
  lateNotificationAlerts(form, alerts);

  // --- COVERAGE / DATE GAPS ---
  coverageAlerts(form, alerts);

  // --- MISSING DATA ---
  missingDataAlerts(form, alerts);

  // --- CHARGE WARNINGS ---
  chargeAlerts(form, alerts);

  return alerts;
}

function lateNotificationAlerts(form, alerts) {
  const { storageStartDate, claimReportDate } = form;
  if (!storageStartDate || !claimReportDate) return;

  const days = daysBetween(storageStartDate, claimReportDate);
  if (days <= 3) return;

  // Determine the reason / severity
  let reason = "";
  if (days > 30) {
    reason = `Vehicle sat for ${days} days before claim was filed — likely a tow yard hold or delayed reporting. Expect storage dispute.`;
  } else if (days > 14) {
    reason = `Vehicle arrived ${days} days before claim was filed — significant delay. Shop may have been waiting on insured authorization.`;
  } else if (days > 7) {
    reason = `Vehicle arrived ${days} days before claim was filed — moderate delay. Insured may have delayed reporting the loss.`;
  } else {
    reason = `Vehicle arrived ${days} days before claim was filed — minor delay, but storage starts at Date of Notice.`;
  }

  alerts.push({
    level: days > 14 ? "error" : "warn",
    title: "LATE NOTIFICATION",
    message: reason,
    key: "late-notif",
  });
}

function coverageAlerts(form, alerts) {
  const { storageStartDate, claimReportDate, tlDate } = form;
  const audit = form.audit || {};

  // Storage end date is after coverage end
  if (form.chargesBilledThrough && audit.storageEndDate) {
    const billedEnd = parseDate(form.chargesBilledThrough);
    const covEnd = parseDate(audit.storageEndDate);
    if (billedEnd && covEnd && billedEnd > covEnd) {
      const overDays = daysBetween(audit.storageEndDate, form.chargesBilledThrough);
      alerts.push({
        level: "warn",
        title: "BILLING PAST COVERAGE",
        message: `Shop is billing ${overDays} day(s) beyond the coverage end date. Only approve through ${audit.storageEndDate}.`,
        key: "billing-past-coverage",
      });
    }
  }

  // TL date exists but no mitigation cut-off set
  if (tlDate && !(form.mitigation || {}).cutOffDate) {
    alerts.push({
      level: "info",
      title: "MITIGATION NEEDED",
      message: `Total Loss date is ${tlDate} but no cut-off date is set. Use AUTO-CALC or set manually.`,
      key: "no-cutoff",
    });
  }

  // Coverage start is before arrival (shouldn't normally happen)
  if (audit.storageStartDate && storageStartDate) {
    const covStart = parseDate(audit.storageStartDate);
    const arrival = parseDate(storageStartDate);
    if (covStart && arrival && covStart < arrival) {
      alerts.push({
        level: "warn",
        title: "COVERAGE BEFORE ARRIVAL",
        message: `Coverage start (${audit.storageStartDate}) is before vehicle arrival (${storageStartDate}). Verify dates.`,
        key: "cov-before-arrival",
      });
    }
  }

  // High storage day count
  if (audit.approvedStorageDays && Number(audit.approvedStorageDays) > 60) {
    alerts.push({
      level: "warn",
      title: "EXTENDED STORAGE",
      message: `${audit.approvedStorageDays} approved storage days is unusually high. Verify the coverage period and mitigation efforts.`,
      key: "high-storage-days",
    });
  }
}

function missingDataAlerts(form, alerts) {
  // Only show these after some data exists (not on blank form)
  const hasAnyData = form.claimNumber || form.shopName || form.storageStartDate;
  if (!hasAnyData) return;

  const missing = [];

  if (form.claimNumber && !form.vin) missing.push("VIN");
  if (form.claimNumber && !form.insuredName) missing.push("Insured Name");
  if (form.shopName && !form.shopPhone) missing.push("Shop Phone");
  if (form.shopName && !form.shopAddress) missing.push("Shop Address");
  if (form.storageStartDate && !form.claimReportDate) missing.push("Claim Reported Date");
  if (form.charges?.length > 0 && !form.storageStartDate) missing.push("Storage Start Date");

  if (missing.length > 0) {
    alerts.push({
      level: "info",
      title: "MISSING INFO",
      message: `Still need: ${missing.join(", ")}`,
      key: "missing-data",
    });
  }

  // VIN length check
  if (form.vin && form.vin.replace(/\s/g, "").length !== 17 && form.vin.replace(/\s/g, "").length > 0) {
    alerts.push({
      level: "warn",
      title: "VIN LENGTH",
      message: `VIN is ${form.vin.replace(/\s/g, "").length} characters — should be 17. Double-check for typos.`,
      key: "vin-length",
    });
  }
}

function chargeAlerts(form, alerts) {
  const charges = form.charges || [];
  if (charges.length === 0) return;

  // Storage charge: check rate vs market
  const storageCharge = charges.find(c => c.name?.toLowerCase() === "storage");
  if (storageCharge) {
    const rate = Number(storageCharge.rate);
    if (rate > 0) {
      if (rate > 350) {
        alerts.push({
          level: "error",
          title: "HIGH STORAGE RATE",
          message: `Shop is billing $${rate}/day — well above typical CA market rates ($175-$275). Negotiate down.`,
          key: "high-storage-rate",
        });
      } else if (rate > 275) {
        alerts.push({
          level: "warn",
          title: "ABOVE-MARKET RATE",
          message: `Storage rate of $${rate}/day is above the typical range. Verify the area rate supports this.`,
          key: "above-market-rate",
        });
      }
    }

    // Storage days unusually high on the invoice
    const billedDays = Number(storageCharge.days);
    if (billedDays > 90) {
      alerts.push({
        level: "error",
        title: "EXCESSIVE STORAGE DAYS",
        message: `Shop billing for ${billedDays} days of storage. Verify mitigation and consider partial denial.`,
        key: "excessive-days",
      });
    }
  }

  // Teardown over $600
  const teardown = charges.find(c => c.name?.toLowerCase().includes("teardown") || c.name?.toLowerCase().includes("tear down"));
  if (teardown && Number(teardown.amount) > 600) {
    alerts.push({
      level: "warn",
      title: "HIGH TEARDOWN",
      message: `Teardown billed at $${Number(teardown.amount).toLocaleString()} — typical range is $250-$500. Verify scope of work.`,
      key: "high-teardown",
    });
  }

  // Total billed over $10k
  const totalBilled = charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  if (totalBilled > 10000) {
    alerts.push({
      level: "warn",
      title: "HIGH TOTAL BILLED",
      message: `Total shop charges: $${totalBilled.toLocaleString()} — review each line item carefully.`,
      key: "high-total",
    });
  }

  // Count denied charges
  const deniedCharges = charges.filter(c => c.autoDenied && Number(c.amount) > 0);
  if (deniedCharges.length > 0) {
    const deniedTotal = deniedCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
    alerts.push({
      level: "info",
      title: "AB-2392 DENIALS",
      message: `${deniedCharges.length} charge(s) auto-denied totaling $${deniedTotal.toLocaleString()}: ${deniedCharges.map(c => c.name).join(", ")}`,
      key: "ab2392-denials",
    });
  }
}
