const planNameOverrides: Record<string, string> = {
  "ظ…ط­ط¯ظˆط¯": "محدود",
  "ط£ط³ط§ط³ظٹ": "أساسي",
  "ط§ط­طھط±ط§ظپظٹ": "احترافي",
  "ظ…ظ…ظٹط²": "مميز",
  "ط¯ظˆظ„ظٹ ط£ط³ط§ط³ظٹ": "دولي أساسي",
  "ط¯ظˆظ„ظٹ ط§ط­طھط±ط§ظپظٹ": "دولي احترافي",
  "ط£ط±ط´ظٹظپظٹط©": "أرشيفية",
};

export function normalizePlanName(name: string | null | undefined) {
  if (!name) return name;
  return planNameOverrides[name] || name;
}
