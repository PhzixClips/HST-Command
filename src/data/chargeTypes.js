// Charge types with auto-deny flags per AB-2392
// denied: true means automatically denied as standard business overhead
// defaultAmount: pre-filled approved amount for charges with fixed rates
export const CHARGE_TYPES = [
  { name: "Storage", denied: false, hasRate: true, hasDays: true, hasDateRange: true },
  { name: "Advance Tow", denied: false, approveAsBilled: true },
  { name: "Teardown", denied: false },
  { name: "Labor", denied: false },
  { name: "Extra Equipment", denied: false, defaultAmount: 250 },
  { name: "Dolly", denied: false, defaultAmount: 250 },
  { name: "Clean Up", denied: false, defaultAmount: 250 },
  { name: "Pre-Scan", denied: false, defaultAmount: 65 },
  { name: "Lien", denied: false, approveAsBilled: true },
  { name: "Administrative Fee", denied: true },
  { name: "Gate Fee", denied: true },
  { name: "Estimate Fee", denied: true },
  { name: "Impound Fee", denied: true },
  { name: "Vehicle Inspection", denied: true },
  { name: "Hook Up", denied: true },
  { name: "Yard Fee", denied: true },
  { name: "Environmental Fee", denied: true },
  { name: "Release Fee", denied: true },
  { name: "Battery Maintenance", denied: true },
  { name: "Cover Car", denied: true },
  { name: "Other", denied: false },
];

export const DENIED_CHARGE_NAMES = CHARGE_TYPES
  .filter(c => c.denied)
  .map(c => c.name);

export function isChargeDenied(chargeName) {
  const lower = chargeName.toLowerCase();
  return CHARGE_TYPES.some(
    c => c.denied && c.name.toLowerCase() === lower
  ) || [
    "admin", "forklift", "gate", "impound",
    "estimate", "inspection", "hookup", "hook up",
    "yard", "environmental", "release", "battery",
    "cover car",
  ].some(keyword => lower.includes(keyword));
}

export function getDefaultAmount(chargeName) {
  const lower = chargeName.toLowerCase().trim();
  const normalized = lower.replace(/\s+/g, "");
  const match = CHARGE_TYPES.find(c => {
    const cLower = c.name.toLowerCase();
    const cNorm = cLower.replace(/\s+/g, "");
    return cLower === lower || cNorm === normalized || lower.includes(cLower) || cLower.includes(lower);
  });
  if (!match) return null;
  if (match.defaultAmount) return match.defaultAmount;
  if (match.approveAsBilled) return "billed";
  return null;
}
