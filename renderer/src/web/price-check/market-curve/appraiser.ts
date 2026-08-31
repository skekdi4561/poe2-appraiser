// 공격 무기 시세 감정소 — 시장 곡선 데이터 (이 포크의 차별화 기능)
// 데이터는 공개 사이트의 24시간 합집합 스냅샷(latest.json)을 직접 읽는다.
// GitHub Pages 는 CORS 를 열어두므로 렌더러에서 바로 fetch 가 된다 — 별도 프로세스 0.
// 판정·조건 필터 로직은 감정소(serve.py / index.html)와 같은 규칙의 TS 포트다.

const SNAPSHOT_BASE = "https://skekdi4561.github.io/poe2-bow/";
// 활은 latest.json, 다른 공격무기는 latest.<접미사>.json (감정소 serve.py ATTACK_WEAPONS 규칙).
export function snapshotUrl(suffix = ""): string {
  return SNAPSHOT_BASE + (suffix ? `latest.${suffix}.json` : "latest.json");
}
const CACHE_MS = 10 * 60 * 1000; // 사이트 CDN 캐시와 같은 10분
const ROW_TTL = 24 * 60 * 60 * 1000; // 감정소와 같은 규칙: 수집 24시간이 지난 매물은 제외
// 환율 수집이 실패한 스냅샷에서도 축척이 살도록 — 감정소 RATE_DEFAULT 와 같은 값
// ⚠️ mirror 가 빠지면 rateOf 가 0 을 돌려 미러 가격 활이 '공짜'로 최전선을 점령한다
// (감정소 index.html RATE_DEFAULT 와 같은 이유). 스냅샷 환율이 없을 때의 안전망.
const DEFAULT_RATES: Record<string, number> = {
  exalted: 1,
  chaos: 65,
  divine: 300,
  annul: 279,
  mirror: 2_000_000,
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
export interface TrendPoint {
  t: number;
  floors: Record<string, number>; // 앵커 DPS(문자열) → 그때 최저가(엑잘)
}
export interface Trend {
  anchors: number[];
  points: TrendPoint[];
}
interface Snapshot {
  taken_at?: number;
  rates?: Record<string, { rate?: number } | number>;
  bows?: SnapshotBow[];
  trend?: Trend | null;
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
  staleKept: boolean; // 24h 이내가 부족해 낡은 매물로 대체했는가(수집 중단 추정) — index.html staleKept 와 같음
  trend: Trend | null; // 가격 추세(앵커 DPS 별 최저가 시계열) — 없으면 null
}

// 무기별로 캐시/inflight 를 따로 둔다 — 활과 다른 무기가 서로의 스냅샷을 덮어쓰지 않게.
const cache = new Map<string, { at: number; data: Snapshot | null }>();
const inflightBy = new Map<string, Promise<Snapshot | null>>();

async function fetchSnapshot(suffix = ""): Promise<Snapshot | null> {
  const c = cache.get(suffix);
  if (c && Date.now() - c.at < CACHE_MS) return c.data;
  const pending = inflightBy.get(suffix);
  if (pending) return pending;
  const p = (async () => {
    try {
      const r = await fetch(snapshotUrl(suffix));
      const data = (await r.json()) as Snapshot;
      cache.set(suffix, { at: Date.now(), data });
      return data;
    } catch {
      const prev = cache.get(suffix)?.data ?? null;
      cache.set(suffix, { at: Date.now() - CACHE_MS + 60_000, data: prev }); // 실패 시 1분 뒤 재시도
      return prev;
    } finally {
      inflightBy.delete(suffix);
    }
  })();
  inflightBy.set(suffix, p);
  return p;
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
  /increased Attack Speed|reduced Attack Speed|^공격 속도 [\d.]+% (증가|감소)/i,
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

// 옵션 표시 순서 — 감정소 index.html 의 optRank/byUsefulness 와 같은 규칙이어야 한다.
// 빈도만으로 줄세우면 유용도와 어긋난다(실측: 활에서 "반려수의 공격 속도" 133 이
// "모든 투사체 스킬 레벨" 120 보다 위였다 — 앞은 동료 빌드 전용이라 무기 값과 거의 무관).
//   0 = 무기 성능 직결 / 1 = 그 외 / 2 = 무기가 아닌 대상(반려수·소환수)
const OPT_TOP =
  /스킬 레벨|치명타|흡수|추가로 발사|추가 화살|Skill Level|Critical|Leech/;
const OPT_BOTTOM = /반려수|소환수|Companion|Minion/;
export function optRank(key: string): number {
  if (OPT_BOTTOM.test(key)) return 2;
  if (OPT_TOP.test(key)) return 0;
  return 1;
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
    .sort((a, b) => optRank(a.key) - optRank(b.key) || b.n - a.n);
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

// 신뢰 경계(네트워크 fetch JSON)에서 숫자를 강제한다 — pdps 가 문자열 "227" 로
// 오면 pdps+edps 가 문자열 결합("22738")되어 frontier 정렬을 통째로 망가뜨린다(실측).
// serve.py/worker 가 숫자를 보장하지만, 읽는 쪽도 방어하는 게 4회차 원칙의 연장이다.
const numOr0 = (v: unknown): number =>
  typeof v === "number" && isFinite(v) ? v : 0;

// 스냅샷 → 24h 유효 매물 목록 (순수 함수라 테스트 가능)
export function rowsFromSnapshot(
  snap: Snapshot,
  rates: Record<string, number>,
  fallbackCurs: Set<string>,
  now: number = Date.now(),
): { rows: RichRow[]; rateFallback: boolean; staleKept: boolean } {
  const cut = now - ROW_TTL;
  let rateFallback = false;
  const fresh: RichRow[] = [];
  const all: RichRow[] = [];
  for (const b of snap.bows ?? []) {
    if ((b.rarity ?? "Rare") !== "Rare") continue;
    const r = rates[b.cur ?? ""] ?? 0;
    const price = numOr0(b.price);
    if (r <= 0 || price <= 0) continue;
    const t = numOr0(b.t) || numOr0(snap.taken_at);
    const pdps = numOr0(b.pdps);
    const edps = numOr0(b.edps);
    if (pdps + edps <= 0) continue;
    if (fallbackCurs.has(b.cur!)) rateFallback = true;
    const row = { pdps, edps, p: price * r, t, offs: offMods(b.mods ?? []) };
    all.push(row);
    if (t >= cut) fresh.push(row);
  }
  // 신선분이 곡선을 못 그릴 만큼 적으면(수집 중단 추정) 낡은 매물이라도 보여준다 —
  // 빈 화면/"불러오지 못함"은 고장으로 보인다. index.html partition 의 staleKept 와 같은 규칙.
  if (fresh.length < 2 && all.length >= 2) {
    return { rows: all, rateFallback, staleKept: true };
  }
  return { rows: fresh, rateFallback, staleKept: false };
}

// 스냅샷 → 24h 유효 매물(옵션 포함) + 옵션 목록 + 환율
export async function marketBoard(suffix = ""): Promise<MarketBoard | null> {
  const snap = await fetchSnapshot(suffix);
  if (!snap?.bows?.length) return null;

  const { rates, fallbackCurs } = parseRates(snap);
  const { rows, rateFallback, staleKept } = rowsFromSnapshot(
    snap,
    rates,
    fallbackCurs,
  );
  if (rows.length < 2) return null;

  return {
    rows,
    stats: statOptions(rows),
    sample: rows.length,
    ageHours: (Date.now() - Math.max(...rows.map((r) => r.t))) / 3_600_000,
    rates,
    rateFallback,
    staleKept,
    trend: snap.trend ?? null,
  };
}
