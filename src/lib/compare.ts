const COMMON_WORDS = new Set([
  "已发评价",
  "已返款",
  "评价",
  "返款",
  "微信",
  "工作表",
  "状态",
  "修改",
  "客户",
  "姓名",
  "名字",
  "备注",
  "金额",
  "未评价",
  "已评价",
  "需催促",
  "人员",
  "表单"
]);

export interface CompareEntry {
  name: string;
  source: string;
}

export function parseCompareEntries(input: string): CompareEntry[] {
  const normalized = input
    .replace(/\r/g, "\n")
    .replace(/\t/g, "\n");
  const candidates: CompareEntry[] = [];

  for (const block of normalized.split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;

    const cleaned = line
      .replace(/^[\d.\s\-#、]+/, "")
      .replace(/[，,;；|]/g, " ")
      .trim();
    if (!cleaned) continue;

    if (isNoiseLine(cleaned)) continue;

    const wholeName = cleaned.replace(/\s+/g, "");
    if (wholeName.length >= 2 && wholeName.length <= 30 && isLikelyName(wholeName)) {
      candidates.push({ name: wholeName, source: line });
      continue;
    }

    const parts = cleaned.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length >= 2 && isLikelyName(trimmed) && !isNoiseName(trimmed) && !COMMON_WORDS.has(trimmed)) {
        candidates.push({ name: trimmed, source: line });
      }
    }
  }

  const deduped = new Map<string, CompareEntry>();
  candidates.forEach((entry) => {
    const key = normalizeCompareName(entry.name);
    if (key && !deduped.has(key)) deduped.set(key, { ...entry, name: entry.name.trim() });
  });
  return [...deduped.values()];
}

function isLikelyName(value: string): boolean {
  if (/^[一-龥]{2,20}$/.test(value)) return true;
  if (/^[a-zA-Z][a-zA-Z0-9_.\-]{1,30}$/.test(value)) return true;
  if (/^tb[_\-]?\w{1,28}$/i.test(value)) return true;
  if (/^[一-龥a-zA-Z0-9_]{2,30}$/.test(value) && /[一-龥]/.test(value)) return true;
  if (/^[一-龥a-zA-Z0-9_]{2,30}$/.test(value) && /[a-zA-Z0-9]/.test(value)) return true;
  return false;
}

export function normalizeCompareName(name: string) {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

function isNoiseName(name: string) {
  return COMMON_WORDS.has(name) || /^(评价|返款|状态|微信|工作|表单|修改|已经|以下|人员|催促|备注|金额|客户|姓名|名字)$/.test(name);
}

function isNoiseLine(line: string) {
  const compact = line.replace(/\s+/g, "");
  if (compact.length < 2) return true;
  if (/^[\d\s.%¥$]+$/.test(compact)) return true;
  const noiseRatio = (compact.match(/[已发评价返款微信工作表状态修改客户姓名备注金额人员催促表单未需]/g) || []).length / compact.length;
  return noiseRatio > 0.85 && compact.length <= 8;
}
