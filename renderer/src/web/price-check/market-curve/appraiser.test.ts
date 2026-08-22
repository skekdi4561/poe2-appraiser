// 시장 곡선 판정 — 감정소(serve.py/index.html)와 같은 픽스처·같은 답이어야 한다
import { describe, it, expect } from "vitest";
import { frontier, formatEx } from "./appraiser";

describe("frontier", () => {
  it("전수 비교와 같은 판정", () => {
    const f = frontier([
      { d: 100, p: 5, t: 0 },
      { d: 150, p: 20, t: 0 },
      { d: 120, p: 30, t: 0 },
      { d: 150, p: 18, t: 0 },
    ]);
    expect(f.map((x) => [x.d, x.p])).toEqual([
      [100, 5],
      [150, 18],
    ]);
  });
  it("동점(같은 DPS·가격)은 전원 생존", () => {
    expect(frontier([{ d: 1, p: 2, t: 0 }, { d: 1, p: 2, t: 0 }])).toHaveLength(2);
    expect(frontier([{ d: 1, p: 2, t: 0 }, { d: 1, p: 3, t: 0 }])).toHaveLength(1);
    expect(frontier([{ d: 2, p: 2, t: 0 }, { d: 1, p: 2, t: 0 }])).toHaveLength(1);
    expect(frontier([])).toHaveLength(0);
  });
});

describe("formatEx", () => {
  const rates = { exalted: 1, divine: 400 };
  it("1 디바인어치부터 div 표기 (감정소 money 와 같은 규칙)", () => {
    expect(formatEx(5, rates)).toBe("5.00 ex");
    expect(formatEx(399, rates)).toBe("399 ex");
    expect(formatEx(400, rates)).toBe("1.00 div");
    expect(formatEx(590800, rates)).toBe("1,477 div");
  });
  it("디바인 환율이 깨져 있으면 ex 로 남는다", () => {
    expect(formatEx(590800, { exalted: 1, divine: 0 })).toBe("590,800 ex");
  });
});
