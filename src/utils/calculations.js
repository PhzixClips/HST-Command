// Auto-calculation helpers for charges, totals, disputed amounts

export function calcTotalBilled(charges) {
  return charges.reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
}

export function calcTotalDenied(charges) {
  return charges
    .filter(c => c.autoDenied)
    .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
}

export function calcApprovedStorage(rate, days) {
  return (parseFloat(rate) || 0) * (parseInt(days) || 0);
}

export function calcTotalApproved(audit) {
  return (
    (parseFloat(audit.approvedStorageAmount) || 0) +
    (parseFloat(audit.approvedTow) || 0) +
    (parseFloat(audit.approvedTeardown) || 0) +
    (parseFloat(audit.approvedLabor) || 0) +
    (parseFloat(audit.approvedOther) || 0)
  );
}

export function calcDisputed(totalBilled, totalApproved) {
  return Math.max(0, totalBilled - totalApproved);
}

export function fmt(num) {
  const n = parseFloat(num) || 0;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDollar(num) {
  return `$${fmt(num)}`;
}
