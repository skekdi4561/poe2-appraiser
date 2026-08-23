// 활 시세 감정소 — 시장 곡선 판정 (이 포크의 차별화 기능)
// 데이터는 공개 사이트의 24시간 합집합 스냅샷(latest.json)을 직접 읽는다.
// GitHub Pages 는 CORS 를 열어두므로 렌더러에서 바로 fetch 가 된다 — 별도 프로세스 0.
// 판정 로직은 감정소(serve.py / index.html)와 같은 규칙의 TS 포트다.
import { ParsedItem, ItemRarity } from "@/parser";
import { ItemCategory } from "@/parser/meta";

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
}
interface Snapshot {
  taken_at?: number;
  rates?: Record<string, { rate?: number } | number>;
  bows?: SnapshotBow[];
}
interface Row {
  d: number;
  p: number;
  t: number;
}

export interface CurveVerdict {
  totalDps: number;
  physDps: number;
  eleDps: number;
  floor?: { dps: number; price: string };
  next?: { dps: number; price: string };
  aboveMarket?: number; // 시장 관측 최고 DPS 보다 높을 때 그 최고값
  sample: number;
  ageHours: number;
  rateFallback: boolean;
  notRare: boolean;
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
  for (const c of new Set([...Object.keys(raw), ...Object.keys(DEFAULT_RATES)])) {
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
  return `${v.toLocaleString("ko-KR", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })} ${useDiv ? "div" : "ex"}`;
}

export function isBow(item: ParsedItem): boolean {
  return item.category === ItemCategory.Bow;
}

// 스냅샷 → 24h 유효 매물 → 최전선. 가격 검사(appraise)와 독립 위젯이 공유한다.
export interface MarketBoard {
  front: Row[];
  sample: number;
  ageHours: number;
  rates: Record<string, number>;
  rateFallback: boolean;
}

export async function marketFrontier(): Promise<MarketBoard | null> {
  const snap = await fetchSnapshot();
  if (!snap?.bows?.length) return null;

  const { rates, fallbackCurs } = parseRates(snap);
  const cut = Date.now() - ROW_TTL;
  let rateFallback = false;
  const rows: Row[] = [];
  for (const b of snap.bows) {
    if ((b.rarity ?? "Rare") !== "Rare") continue;
    const r = rates[b.cur ?? ""] ?? 0;
    if (r <= 0 || !b.price) continue;
    const t = b.t ?? snap.taken_at ?? 0;
    if (t < cut) continue;
    const d = (b.pdps ?? 0) + (b.edps ?? 0);
    if (d <= 0) continue;
    if (fallbackCurs.has(b.cur!)) rateFallback = true;
    rows.push({ d, p: b.price * r, t });
  }
  if (rows.length < 2) return null;

  return {
    front: frontier(rows),
    sample: rows.length,
    ageHours: (Date.now() - Math.max(...rows.map((r) => r.t))) / 3_600_000,
    rates,
    rateFallback,
  };
}

export async function appraise(item: ParsedItem): Promise<CurveVerdict | null> {
  if (!isBow(item)) return null;
  // weaponPHYSICAL/ELEMENTAL 은 DPS 가 아니라 타당 평균 피해 — 수집기(serve.py)와 같이 공속을 곱한다.
  // 고유 아이템은 파서가 무기 수치를 전부 지우므로(Parser.ts "undo everything") 여기서 0이 되어 null 반환된다.
  const aps = item.weaponAS ?? 0;
  const physDps = (item.weaponPHYSICAL ?? 0) * aps;
  const eleDps = (item.weaponELEMENTAL ?? 0) * aps;
  const totalDps = physDps + eleDps;
  if (totalDps <= 0) return null;
  const board = await marketFrontier();
  if (!board) return null;
  const { front, rates, rateFallback } = board;
  const hi = front[front.length - 1];
  const verdict: CurveVerdict = {
    totalDps,
    physDps,
    eleDps,
    sample: board.sample,
    ageHours: board.ageHours,
    rateFallback,
    notRare: item.rarity !== ItemRarity.Rare,
  };
  if (totalDps > hi.d) {
    verdict.aboveMarket = hi.d;
    return verdict;
  }
  const floor = front.find((f) => f.d >= totalDps);
  if (floor) {
    verdict.floor = { dps: floor.d, price: formatEx(floor.p, rates) };
    const next = front.find((f) => f.d > floor.d);
    if (next) verdict.next = { dps: next.d, price: formatEx(next.p, rates) };
  }
  return verdict;
}
