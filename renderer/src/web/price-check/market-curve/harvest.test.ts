// 업로드 큐: 배치 초과분이 유실되지 않고 이어 전송되는지 (2회차 자가검증에서 잡은 결함)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { _queue, _flush, FLUSH_MAX } from "./harvest";

function fakeRow(i: number) {
  return {
    id: "row" + i, name: "활" + i, pdps: 100 + i, edps: 0, aps: 1.2, crit: 5,
    price: 3, cur: "divine", rarity: "Rare", mods: ["옵션 +1"], league: "Standard",
  };
}

describe("flush 배치", () => {
  const sent: number[] = [];
  beforeEach(() => {
    sent.length = 0;
    _queue.clear();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body).rows.length);
      return Promise.resolve(new Response("{}"));
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("배치 초과분은 버리지 않고 이어서 보낸다", () => {
    for (let i = 0; i < 70; i++) _queue.set("row" + i, fakeRow(i) as never);
    _flush();
    expect(sent).toEqual([FLUSH_MAX]);
    expect(_queue.size).toBe(70 - FLUSH_MAX);
    vi.advanceTimersByTime(1100);
    vi.advanceTimersByTime(1100);
    expect(sent).toEqual([FLUSH_MAX, FLUSH_MAX, 70 - 2 * FLUSH_MAX]);
    expect(_queue.size).toBe(0);
  });

  it("본문이 keepalive 한도(64KB) 안에 든다 — 실측 최대 행 기준", () => {
    const fat = fakeRow(0);
    fat.mods = Array(12).fill("아주 긴 한글 옵션 문자열이라고 가정한 것 ##.#% 증가");
    const body = JSON.stringify({ rows: Array(FLUSH_MAX).fill(fat) });
    expect(new TextEncoder().encode(body).length).toBeLessThan(64 * 1024);
  });
});

import { harvestCtxOf } from "./harvest";
import { ItemCategory } from "@/parser/meta";

describe("harvestCtxOf (수집 대상 무기 판정 · 경쟁 조건 방지)", () => {
  it("검색마다 독립 문맥 — 나중 검색이 앞 검색 문맥을 덮지 않는다", () => {
    const bow = harvestCtxOf({ category: ItemCategory.Bow } as never, "Standard");
    const sword = harvestCtxOf({ category: ItemCategory.OneHandedSword } as never, "Standard");
    // 전역 상태가 아니라 값이므로, 둘째 호출이 첫째를 오염시키지 않는다
    expect(bow.cat).toBe("weapon.bow");
    expect(sword.cat).toBeNull();
  });
  it("POE2 에 있는 공격 무기 6종은 각자 카테고리로 수집된다", () => {
    const cases: Array<[ItemCategory, string]> = [
      [ItemCategory.Bow, "weapon.bow"],
      [ItemCategory.Crossbow, "weapon.crossbow"],
      [ItemCategory.OneHandedMace, "weapon.onemace"],
      [ItemCategory.TwoHandedMace, "weapon.twomace"],
      [ItemCategory.Spear, "weapon.spear"],
      [ItemCategory.Warstaff, "weapon.warstaff"],
    ];
    for (const [cat, id] of cases) {
      expect(harvestCtxOf({ category: cat } as never, "L").cat).toBe(id);
    }
  });
  it("캐스터·미출시 무기·방어구는 수집 대상이 아니다(cat=null)", () => {
    for (const cat of [
      ItemCategory.Wand,
      ItemCategory.Sceptre,
      ItemCategory.Staff,
      ItemCategory.OneHandedSword,
      ItemCategory.TwoHandedAxe,
      ItemCategory.Dagger,
      ItemCategory.Claw,
      ItemCategory.Boots,
    ]) {
      expect(harvestCtxOf({ category: cat } as never, "L").cat).toBeNull();
    }
  });
  it("카테고리가 없는 아이템도 안 죽는다", () => {
    expect(harvestCtxOf({} as never, "L").cat).toBeNull();
  });
});

import { normalizeResult } from "./harvest";

describe("normalizeResult — serve.py normalize 정합", () => {
  const base = {
    id: "x1",
    item: { extended: { pdps: 100, edps: 0 }, typeLine: "고급 활" },
    listing: { price: { currency: "divine", amount: 3 } },
  };
  it("rarity 문자열이 있으면 그대로", () => {
    const r = normalizeResult({ ...base, item: { ...base.item, rarity: "Rare" } }, "Standard");
    expect(r?.rarity).toBe("Rare");
  });
  it("rarity 누락 + frameType=2 → 'Rare' (frameType 폴백, serve.py rarity_of 와 정합)", () => {
    // 이 폴백이 없으면 API 가 rarity 를 생략한 레어 활이 ''로 저장돼 곡선에서 빠졌다
    const r = normalizeResult({ ...base, item: { ...base.item, frameType: 2 } }, "Standard");
    expect(r?.rarity).toBe("Rare");
  });
  it("rarity·frameType 둘 다 없으면 ''", () => {
    const r = normalizeResult(base, "Standard");
    expect(r?.rarity).toBe("");
  });
  it("룬 변형 frameType 13 → 'Rare'", () => {
    const r = normalizeResult({ ...base, item: { ...base.item, frameType: 13 } }, "Standard");
    expect(r?.rarity).toBe("Rare");
  });
  it("pdps 반올림은 half-up — serve.py round1 과 지문 일치", () => {
    // 224.25 → 224.3 (half-up). Python round()(banker's)면 224.2 라 지문이 갈렸다.
    const r = normalizeResult(
      { ...base, item: { ...base.item, extended: { pdps: 224.25, edps: 0 }, rarity: "Rare" } },
      "Standard",
    );
    expect(r?.pdps).toBe(224.3);
  });
});

describe("normalizeResult 미러 가격", () => {
  it("mirror 화폐 매물을 버리지 않는다 (serve.py PRICE_CURRENCIES 정합)", () => {
    const r = normalizeResult(
      { id: "m1", item: { extended: { pdps: 1500, edps: 0 }, typeLine: "활", rarity: "Rare" },
        listing: { price: { currency: "mirror", amount: 1 } } },
      "Standard",
    );
    expect(r?.cur).toBe("mirror");
  });
});

import { poeWebApi } from "@/web/Config";
import { harvestFetchResults } from "./harvest";

// specs/vitest.setup.ts 의 전역 스텁에는 poeWebApi 가 없다 — 여기서 realm 판정만 갈아 끼운다
vi.mock("@/web/Config", () => ({ poeWebApi: vi.fn() }));

describe("harvestFetchResults realm 게이트 (V42 — UI 언어가 아니라 실제 질의 호스트)", () => {
  const ctx = { cat: "weapon.bow", league: "L" };
  const res = {
    id: "k1",
    item: { extended: { pdps: 100, edps: 0 }, typeLine: "활", rarity: "Rare" },
    listing: { price: { currency: "divine", amount: 3 } },
  };
  beforeEach(() => {
    _queue.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _queue.clear();
    vi.runAllTimers(); // 5초 flush 타이머를 비워 다음 테스트로 새지 않게
    vi.useRealTimers();
  });
  it("국제 서버(www) 응답은 큐에 넣지 않는다 — ko + '선호 거래 사이트=www' 오염 방지", () => {
    vi.mocked(poeWebApi).mockReturnValue("www.pathofexile.com");
    harvestFetchResults([res], ctx);
    expect(_queue.size).toBe(0); // 언어로 판정하면 여기서 1 이 된다
  });
  it("카카오 거래소 응답은 큐에 넣는다", () => {
    vi.mocked(poeWebApi).mockReturnValue("poe.kakaogames.com");
    harvestFetchResults([res], ctx);
    expect(_queue.size).toBe(1); // 게이트가 뒤집히면 수집이 통째로 꺼진다
  });
});
