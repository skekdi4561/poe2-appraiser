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
