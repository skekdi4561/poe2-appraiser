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
interface Snapshot {
  taken_at?: number;
  rates?: Record<string, { rate?: number } | number>;
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
// 24h 매물에서 실제로 관측된 옵션 하나 — 필터 검색 목록의 항목
export interface StatOption {
  key: string; // "치명타 확률 #%" 처럼 숫자를 # 으로 지운 옵션 열쇠
  n: number; // 이 옵션을 가진 매물 수
  lo: number; // 관측된 최소값 — 입력 힌트용
  hi: number; // 관측된 최대값
}
// 사용자가 추가한 필터 행 — min/max 모두 비우면 "이 옵션이 있기만 하면"
export interface StatFilter {
  key: string;
  min: number | null;
  max: number | null;
}
export interface MarketBoard {
  rows: RichRow[];
  stats: StatOption[];
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

// ---------- 옵션 파싱 (index.html 과 같은 규칙) ----------

// DPS 에 이미 계산된 옵션 — 필터 후보에서 뺀다. 느슨하게 잡으면 "반려수의 공격 속도"
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

// 24h 매물에서 관측된 옵션 전체 목록 — 거래소 필터처럼 검색해 고른다
export function statOptions(rows: RichRow[]): StatOption[] {
  const agg = new Map<string, { n: number; lo: number; hi: number }>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r.offs)) {
      const a = agg.get(k);
      if (!a) agg.set(k, { n: 1, lo: v, hi: v });
      else {
        a.n++;
        if (v < a.lo) a.lo = v;
        if (v > a.hi) a.hi = v;
      }
    }
  return [...agg.entries()]
    .filter(([, a]) => a.n >= 2) // 곡선이 성립하려면 최소 2개
    .map(([key, a]) => ({ key, n: a.n, lo: a.lo, hi: a.hi }))
    .sort((a, b) => b.n - a.n);
}

// 필터 행 전부 만족해야 통과. min/max 비우면 "옵션 존재"만 본다.
export function matchesFilters(
  offs: Record<string, number>,
  filters: StatFilter[],
): boolean {
  return filters.every((f) => {
    const v = offs[f.key] || 0;
    if (v <= 0) return false;
    if (f.min != null && v < f.min) return false;
    if (f.max != null && v > f.max) return false;
    return true;
  });
}

// 지표별 행 변환 — 선택 지표가 0인 활(예: 원소 지표에서 물리 전용 활)은
// 제외한다 — index.html 의 v.d > 0 규칙과 같아야 두 화면의 곡선이 일치한다.
export function metricRows(
  rows: RichRow[],
  metric: "total" | "phys" | "ele",
): Row[] {
  return rows
    .map((r) => ({
      d: metric === "phys" ? r.pdps : metric === "ele" ? r.edps : r.pdps + r.edps,
      p: r.p,
      t: r.t,
    }))
    .filter((r) => r.d > 0);
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

// 스냅샷 → 24h 유효 매물(옵션 포함) + 옵션 목록 + 환율
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
    stats: statOptions(rows),
    sample: rows.length,
    ageHours: (Date.now() - Math.max(...rows.map((r) => r.t))) / 3_600_000,
    rates,
    rateFallback,
  };
}
