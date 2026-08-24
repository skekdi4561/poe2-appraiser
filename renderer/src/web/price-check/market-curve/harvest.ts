// 소극 수집 — 사용자가 스스로 한 가격 검색의 응답에서 활 매물만 추려
// 익명으로 수합 서버에 보낸다. 추가 거래소 API 호출은 0회다(이미 도착한 응답 재활용).
// 판매자 계정명 등 개인 정보는 수집하지 않는다 — 공개 매물 수치만.
// 행 스키마는 감정소 수집기(serve.py normalize)와 글자 단위로 같아야 한다 —
// 어긋나면 24h 합집합의 지문(fingerprint) 중복 제거가 빗나간다.
import { ParsedItem } from "@/parser";
import { ItemCategory } from "@/parser/meta";
import { AppConfig } from "@/web/Config";

// 수집 대상 판정에 필요한 검색 문맥 — 요청마다 명시로 넘긴다(전역 상태 금지).
// 전역 ctx 를 async 응답 시점에 읽으면, 그 사이 다른 검색이 ctx 를 덮어써
// 비-활(검 등, pdps 존재)이 활 데이터로 오염 업로드된다(실측 재현, 13회차).
export interface HarvestCtx {
  isBow: boolean;
  league: string;
}
export function harvestCtxOf(item: ParsedItem, league: string): HarvestCtx {
  return { isBow: item.category === ItemCategory.Bow, league };
}

// Cloudflare Worker 수합 엔드포인트 — 비어 있으면 수집 기능 전체가 꺼진다
export const HARVEST_URL = "https://poe2-bow-harvest.skekdi4561.workers.dev";

// 감정소가 신뢰하는 실거래 화폐 넷 — serve.py TRADE_CURRENCIES 와 같아야 한다
const TRADE_CURRENCIES = new Set(["exalted", "chaos", "divine", "annul"]);
const MOD_KEYS = [
  "implicitMods",
  "explicitMods",
  "runeMods",
  "craftedMods",
  "fracturedMods",
  "enchantMods",
  "desecratedMods",
] as const;

interface HarvestRow {
  id: string;
  name: string;
  pdps: number;
  edps: number;
  aps: number;
  crit: number;
  price: number;
  cur: string;
  rarity: string;
  mods: string[];
  fee?: number;
  league: string;
}

function isKakaoStandard(league: string): boolean {
  // 감정소 데이터는 카카오 스탠다드 리그 기준 — 다른 시장을 섞으면 곡선이 오염된다
  return AppConfig().language === "ko" && league === "Standard";
}

function toNumber(s: unknown): number {
  const m = String(s ?? "").replace(/,/g, "").match(/[\d.]+/);
  return m ? +m[0] : 0;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function prop(item: any, re: RegExp): number {
  for (const p of item.properties ?? []) {
    if (re.test(String(p.name ?? ""))) {
      const v = p.values?.[0]?.[0];
      if (v != null) return toNumber(v);
    }
  }
  return 0;
}

function modLines(item: any): string[] {
  const out: string[] = [];
  for (const key of MOD_KEYS) {
    for (const m of item[key] ?? []) {
      if (typeof m === "string") out.push(m);
      else if (m?.description) out.push(String(m.description));
    }
  }
  return out;
}

// frameType 은 rarity 문자열이 없을 때의 대비책 (12~14 는 룬 박힌 변형).
// serve.py FRAME_RARITY 와 글자 단위로 같아야 한다.
const FRAME_RARITY: Record<number, string> = {
  0: "Normal",
  1: "Magic",
  2: "Rare",
  3: "Unique",
  12: "Magic",
  13: "Rare",
  14: "Unique",
};
// serve.py rarity_of 의 TS 판 — rarity 문자열이 없거나 이상하면 frameType 으로 보정한다.
// 이게 없으면(예전엔 item.rarity ?? "") API 가 rarity 를 생략한 레어 활이 ""로 저장돼
// Rare 필터에서 빠졌다 — 수집기는 frameType 으로 "Rare"로 넣으므로 크라우드만 조용히 누락됐다.
function rarityOf(item: any): string {
  const r = item.rarity;
  if (r === "Normal" || r === "Magic" || r === "Rare" || r === "Unique") return r;
  return FRAME_RARITY[item.frameType] ?? "";
}

// serve.py normalize() 의 TS 판 — null 이면 수집 대상이 아니다 (export 는 테스트 전용)
export function normalizeResult(res: any, league: string): HarvestRow | null {
  const item = res?.item ?? {};
  const listing = res?.listing ?? {};
  const price = listing.price ?? {};
  if (!price.currency || !price.amount) return null;
  if (!TRADE_CURRENCIES.has(price.currency)) return null;
  const ext = item.extended ?? {};
  if (ext.pdps == null && ext.edps == null) return null;
  const name = [item.name, item.typeLine || item.baseType]
    .filter(Boolean)
    .join(" ")
    .trim();
  return {
    id: String(res.id ?? ""),
    name: name || "이름 없음",
    pdps: Math.round((ext.pdps ?? 0) * 10) / 10,
    edps: Math.round((ext.edps ?? 0) * 10) / 10,
    aps: prop(item, /Attacks per Second|초당 공격/),
    crit: prop(item, /Critical .*Chance|치명타/),
    price: price.amount,
    cur: price.currency,
    rarity: rarityOf(item), // serve.py rarity_of 와 정합 — frameType 폴백 포함
    mods: modLines(item),
    // 카카오 즉시구매 매물은 수수료(fee)가 붙는다 — 수합 서버가 신뢰 필터로 쓴다
    fee: typeof listing.fee === "number" ? listing.fee : undefined,
    league,
  };
}
/* eslint-enable */

// 배치 업로드 — 5초 모아 배치로 나눠 보내고, 실패는 조용히 버린다(사용자 경험 우선).
// 한 검색이 최대 100행을 만들 수 있으므로 배치 초과분은 버리지 말고 이어서 보낸다.
// 배치 30행: 실측 행 최대 788B × 30 ≈ 24KB — keepalive 본문 한도(64KB)의 절반 이하.
export const FLUSH_MAX = 30;
export const _queue = new Map<string, HarvestRow>(); // 테스트에서만 직접 접근
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function _flush() {
  flushTimer = null;
  if (!_queue.size || !HARVEST_URL) return;
  const rows: HarvestRow[] = [];
  for (const [k, v] of _queue) {
    rows.push(v);
    _queue.delete(k);
    if (rows.length >= FLUSH_MAX) break;
  }
  fetch(HARVEST_URL + "/harvest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rows }),
    keepalive: true,
  }).catch(() => {});
  if (_queue.size) flushTimer = setTimeout(_flush, 1000); // 남은 행 이어 보내기
}

export function harvestFetchResults(results: unknown[], ctx: HarvestCtx) {
  if (!HARVEST_URL || !ctx.isBow || !isKakaoStandard(ctx.league)) return;
  for (const res of results) {
    const row = normalizeResult(res, ctx.league);
    if (row?.id) _queue.set(row.id, row);
  }
  if (_queue.size && !flushTimer) flushTimer = setTimeout(_flush, 5000);
}
