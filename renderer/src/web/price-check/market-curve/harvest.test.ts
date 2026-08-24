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

describe("harvestCtxOf (경쟁 조건 방지)", () => {
  it("검색마다 독립 문맥 — 나중 검색이 앞 검색 문맥을 덮지 않는다", () => {
    const bow = harvestCtxOf({ category: ItemCategory.Bow } as never, "Standard");
    const sword = harvestCtxOf({ category: ItemCategory.OneHandedSword } as never, "Standard");
    // 전역 상태가 아니라 값이므로, 둘째 호출이 첫째를 오염시키지 않는다
    expect(bow.isBow).toBe(true);
    expect(sword.isBow).toBe(false);
  });
  it("비-활은 isBow=false — 활 데이터로 안 섞인다", () => {
    expect(harvestCtxOf({ category: ItemCategory.OneHandedSword } as never, "Standard").isBow).toBe(false);
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
