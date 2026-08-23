// 시장 곡선 판정 — 감정소(serve.py/index.html)와 같은 픽스처·같은 답이어야 한다
import { describe, it, expect } from "vitest";
import { frontier, formatEx, matchesFilters, statOptions, RichRow } from "./appraiser";

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

describe("matchesFilters", () => {
  const offs = { "치명타 확률 #%": 4, "생명력 최대치 #": 67 };
  it("min/max 직접 입력 판정", () => {
    expect(matchesFilters(offs, [{ key: "치명타 확률 #%", min: 2, max: null }])).toBe(true);
    expect(matchesFilters(offs, [{ key: "치명타 확률 #%", min: 5, max: null }])).toBe(false);
    expect(matchesFilters(offs, [{ key: "치명타 확률 #%", min: null, max: 3 }])).toBe(false);
    expect(matchesFilters(offs, [{ key: "치명타 확률 #%", min: 2, max: 4 }])).toBe(true);
  });
  it("min/max 비우면 존재만 확인, 없는 옵션은 탈락", () => {
    expect(matchesFilters(offs, [{ key: "생명력 최대치 #", min: null, max: null }])).toBe(true);
    expect(matchesFilters(offs, [{ key: "없는 옵션 #", min: null, max: null }])).toBe(false);
  });
  it("여러 행은 전부 만족해야 통과", () => {
    expect(matchesFilters(offs, [
      { key: "치명타 확률 #%", min: 2, max: null },
      { key: "생명력 최대치 #", min: 70, max: null },
    ])).toBe(false);
  });
});

describe("statOptions", () => {
  it("관측 옵션 집계 — 빈도순, 2개 미만 제외, 범위 포함", () => {
    const rows: RichRow[] = [
      { pdps: 1, edps: 0, p: 1, t: 0, offs: { "치명타 확률 #%": 2, "희귀 옵션 #": 9 } },
      { pdps: 1, edps: 0, p: 1, t: 0, offs: { "치명타 확률 #%": 5 } },
    ];
    const s = statOptions(rows);
    expect(s).toHaveLength(1);
    expect(s[0]).toEqual({ key: "치명타 확률 #%", n: 2, lo: 2, hi: 5 });
  });
});
