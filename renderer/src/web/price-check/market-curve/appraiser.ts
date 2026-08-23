// 활 시세 감정소 — 시장 곡선 데이터 (이 포크의 차별화 기능)
// 데이터는 공개 사이트의 24시간 합집합 스냅샷(latest.json)을 직접 읽는다.
// GitHub Pages 는 CORS 를 열어두므로 렌더러에서 바로 fetch 가 된다 — 별도 프로세스 0.
// 판정·조건 필터 로직은 감정소(serve.py / index.html)와 같은 규칙의 TS 포트다.

const SNAPSHOT_URL = "https://skekdi4561.github.io/poe2-bow/latest.json";
const CACHE_MS = 10 * 60 * 1000; // 사이트 CDN 캐시와 같은 10분
const ROW_TTL = 24 * 60 * 60 * 1000; // 감정소와 같은 규칙: 수집 24시간이 지난 매물은 제외
// 환율 수집이 실패한 스냅샷에서도 축척이 살도록 — 감정소 RATE_DEFAULT 와 같은 값
const DEFAULT_RATES: Record<string, number> = {
  exalted: 1,
  chaos: 65,
  divine: 300,
  annul: 279,
};

interface SnapshotBow {
  pdps?: number;
  edps?: number;
  price?: number;
  cur?: string;
  rarity?: string;
  t?: number;
  mods?: string[];
  cond?: string | null;
}
interface SnapshotCond {
  id?: string;
  label?: string;
  key?: string;
  min?: number;
  n?: number;
  why?: string;
}
interface Snapshot {
  taken_at?: number;
  rates?: Record<string, { rate?: number } | number>;
  conds?: SnapshotCond[];
  bows?: SnapshotBow[];
}

export interface Row {
  d: number;
  p: number;
  t: number;
}
export interface RichRow {
  pdps: number;
  edps: number;
  p: number;
  t: number;
  offs: Record<string, number>;
}
export interface CondChip {
  key: string;
  label: string;
  min: number;
  n: number; // 이 조건을 만족하는 24h 매물 수 — 고르기 전 감을 준다
}
export interface MarketBoard {
  rows: RichRow[];
  conds: CondChip[];
  sample: number;
  ageHours: number;
  rates: Record<string, number>;
  rateFallback: boolean;
}

let cached: { at: number; data: Snapshot | null } = { at: 0, data: null };
let inflight: Promise<Snapshot | null> | null = null;

async function fetchSnapshot(): Promise<Snapshot | null> {
  if (Date.now() - cached.at < CACHE_MS) return cached.data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(SNAPSHOT_URL);
      const data = (await r.json()) as Snapshot;
      cached = { at: Date.now(), data };
      return data;
    } catch {
      cached = { at: Date.now() - CACHE_MS + 60_000, data: cached.data }; // 실패 시 1분 뒤 재시도
      return cached.data;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

const okRate = (v: unknown): v is number =>
  typeof v === "number" && isFinite(v) && v >= 1;

function parseRates(snap: Snapshot): {
  rates: Record<string, number>;
  fallbackCurs: Set<string>;
} {
  const raw = snap.rates ?? {};
  const rates: Record<string, number> = {};
  const fallbackCurs = new Set<string>();
  for (const c of new Set([
    ...Object.keys(raw),
    ...Object.keys(DEFAULT_RATES),
  ])) {
    const v = raw[c];
    let r = typeof v === "object" && v ? v.rate : (v as number | undefined);
    if (!okRate(r)) {
      r = DEFAULT_RATES[c] ?? 0;
      if (r && c !== "exalted") fallbackCurs.add(c);
    }
    rates[c] = r!;
  }
  return { rates, fallbackCurs };
}

// ---------- 조건 필터 (index.html 과 같은 규칙) ----------

// DPS 에 이미 계산된 옵션 — 조건 후보에서 뺀다. 느슨하게 잡으면 "반려수의 공격 속도"
// 같은 무관 옵션까지 삼키므로 index.html 과 같은 엄격한 패턴을 유지할 것.
const COUNTED = [
  /increased Physical Damage|^물리 피해 [\d.]+% 증가/i,
  /Adds \d|피해 \d+~\d+ 추가/i,
  /increased Attack Speed|^공격 속도 [\d.]+% 증가/i,
];
const JUNK_MOD = /^결속됨|시야 반경|Light Radius|투사체 사거리|능력치 요구사항/;
const JUNK_EXACT = new Set(["민첩 #", "힘 #", "지능 #", "모든 능력치 #"]);

// "[Physical|물리] 피해" 같은 게임 마크업을 벗긴다
const cleanMod = (m: string) =>
  String(m)
    .replace(/\[([^\]|]*)\|([^\]]*)\]/g, "$2")
    .replace(/\[([^\]]*)\]/g, "$1");
// 숫자를 # 으로 지워 같은 옵션을 같은 열쇠로 묶는다 — 수집기 mod_key 와 글자까지 같아야 한다
const modKey = (m: string) =>
  cleanMod(m)
    .replace(/[\d.]+/g, "#")
    .replace(/\+\s*#/g, "#")
    .replace(/\s+/g, " ")
    .trim();
const modVal = (m: string) => {
  const n = String(m).match(/[\d.]+/);
  return n ? +n[0] : 0;
};
const isOffDps = (m: string) => !COUNTED.some((re) => re.test(cleanMod(m)));

// 활 하나의 { 옵션 열쇠: 값 } — 같은 열쇠가 여러 번이면 큰 값
function offMods(mods: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of mods) {
    if (!isOffDps(m) || JUNK_MOD.test(cleanMod(m))) continue;
    if (JUNK_EXACT.has(modKey(m))) continue;
    const k = modKey(m);
    const v = modVal(m);
    if (!(k in out) || v > out[k]) out[k] = v;
  }
  return out;
}

// 측정 조건의 옵션 열쇠 — key 없는 옛 수집본은 라벨 끝 "이상"만 떼면 옵션 문구가 된다
const condKey = (c: SnapshotCond) =>
  c.key || modKey(String(c.label ?? "").replace(/\s*이상\s*$/, ""));

// "# 열쇠"에 문턱값을 채워 사람이 읽는 라벨로
const fillKey = (key: string, val: number) => key.replace("#", String(val));

export const meetsAll = (
  offs: Record<string, number>,
  preds: Array<{ key: string; min: number }>,
) => preds.every((p) => (offs[p.key] || 0) >= p.min);

// 조건 칩 목록: 수집기의 측정 조건 + 데이터에서 자주 보이는 옵션(중앙값 문턱).
// ponytail: 사이트의 다단 티어 슬라이더 대신 옵션당 한 문턱 — 부족하면 그때 티어를 늘린다.
function buildConds(rows: RichRow[], snapConds: SnapshotCond[]): CondChip[] {
  const chips = new Map<string, CondChip>(); // "key|min" → chip
  const count = (key: string, min: number) =>
    rows.reduce((n, r) => n + ((r.offs[key] || 0) >= min ? 1 : 0), 0);

  for (const c of snapConds) {
    const key = condKey(c);
    const min = c.min ?? 0.0001;
    const label = String(c.label ?? "").includes("#")
      ? fillKey(String(c.label), min) + " 이상"
      : String(c.label ?? key);
    chips.set(key + "|" + min, { key, label, min, n: count(key, min) });
  }

  // 표본 파생: 자주 등장하는 옵션의 중앙값을 문턱으로
  const freq = new Map<string, number[]>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.offs)) {
      if (!freq.has(k)) freq.set(k, []);
      freq.get(k)!.push(v);
    }
  for (const [key, vals] of freq) {
    if (vals.length < 30) continue; // 희귀 옵션은 곡선을 뜰 표본이 안 된다
    vals.sort((a, b) => a - b);
    const med = vals[Math.floor(vals.length / 2)];
    if (![...chips.values()].some((c) => c.key === key)) {
      chips.set(key + "|" + med, {
        key,
        label: fillKey(key, med) + " 이상",
        min: med,
        n: count(key, med),
      });
    }
  }

  return [...chips.values()]
    .filter((c) => c.n >= 2) // 곡선이 성립하는 조건만
    .sort((a, b) => b.n - a.n);
}

// ---------- 최전선 ----------

// 감정소 frontier 와 같은 판정(동점 전원 생존) — DPS 내림차순 한 번 훑기
export function frontier(rows: Row[]): Row[] {
  const s = [...rows].sort((a, b) => b.d - a.d || a.p - b.p);
  const out: Row[] = [];
  let best = Infinity;
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j < s.length && s[j].d === s[i].d) j++;
    const gmin = s[i].p;
    if (gmin < best) {
      for (let k = i; k < j && s[k].p === gmin; k++) out.push(s[k]);
      best = gmin;
    }
    i = j;
  }
  return out.reverse();
}

// 1 디바인어치부터 div 표기 — 감정소 money() 와 같은 규칙
export function formatEx(vEx: number, rates: Record<string, number>): string {
  const dv = rates["divine"] ?? 0;
  const useDiv = okRate(dv) && dv > 1 && Math.abs(vEx) >= dv;
  const v = useDiv ? vEx / dv : vEx;
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  const num = v.toLocaleString("ko-KR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return num + (useDiv ? " div" : " ex");
}

// 스냅샷 → 24h 유효 매물(옵션 포함) + 조건 칩 + 환율
export async function marketBoard(): Promise<MarketBoard | null> {
  const snap = await fetchSnapshot();
  if (!snap?.bows?.length) return null;

  const { rates, fallbackCurs } = parseRates(snap);
  const cut = Date.now() - ROW_TTL;
  let rateFallback = false;
  const rows: RichRow[] = [];
  for (const b of snap.bows) {
    if ((b.rarity ?? "Rare") !== "Rare") continue;
    const r = rates[b.cur ?? ""] ?? 0;
    if (r <= 0 || !b.price) continue;
    const t = b.t ?? snap.taken_at ?? 0;
    if (t < cut) continue;
    const pdps = b.pdps ?? 0;
    const edps = b.edps ?? 0;
    if (pdps + edps <= 0) continue;
    if (fallbackCurs.has(b.cur!)) rateFallback = true;
    rows.push({ pdps, edps, p: b.price * r, t, offs: offMods(b.mods ?? []) });
  }
  if (rows.length < 2) return null;

  return {
    rows,
    conds: buildConds(rows, snap.conds ?? []),
    sample: rows.length,
    ageHours: (Date.now() - Math.max(...rows.map((r) => r.t))) / 3_600_000,
    rates,
    rateFallback,
  };
}
