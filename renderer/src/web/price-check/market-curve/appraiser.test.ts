// 시장 곡선 판정 — 감정소(serve.py/index.html)와 같은 픽스처·같은 답이어야 한다
import { describe, it, expect } from "vitest";
import { frontier, formatEx, matchesFilters, statOptions, metricRows, rowsFromSnapshot, RichRow, snapshotUrl, marketBoard, optRank } from "./appraiser";

describe("snapshotUrl", () => {
  it("활은 latest.json, 다른 무기는 latest.<접미사>.json", () => {
    expect(snapshotUrl("")).toBe("https://skekdi4561.github.io/poe2-bow/latest.json");
    expect(snapshotUrl()).toBe("https://skekdi4561.github.io/poe2-bow/latest.json");
    expect(snapshotUrl("crossbow")).toBe("https://skekdi4561.github.io/poe2-bow/latest.crossbow.json");
    expect(snapshotUrl("warstaff")).toBe("https://skekdi4561.github.io/poe2-bow/latest.warstaff.json");
  });
});

describe("marketBoard 무기별 캐시 격리", () => {
  it("무기마다 자기 URL 을 받고 서로 안 섞이며 캐시는 무기별로 동작", async () => {
    const now = Date.now();
    const mk = (pdps: number) => ({ rarity: "Rare", cur: "exalted", price: 5, t: now, pdps, edps: 0 });
    const bySuffix: Record<string, unknown> = {
      "https://skekdi4561.github.io/poe2-bow/latest.json": { taken_at: now, rates: {}, bows: [mk(100), mk(200)] },
      "https://skekdi4561.github.io/poe2-bow/latest.crossbow.json": { taken_at: now, rates: {}, bows: [mk(300), mk(400)] },
    };
    const calls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return { ok: true, json: async () => bySuffix[String(u)] } as Response;
    }) as typeof fetch;
    try {
      const bow = await marketBoard("");
      const xbow = await marketBoard("crossbow");
      const bow2 = await marketBoard(""); // 같은 무기 재요청 — 캐시에서, 새 fetch 없음
      // 각 무기가 자기 데이터만 봄(섞이면 최고 DPS 가 어긋난다)
      expect(Math.max(...bow!.rows.map((r) => r.pdps))).toBe(200);
      expect(Math.max(...xbow!.rows.map((r) => r.pdps))).toBe(400);
      expect(Math.max(...bow2!.rows.map((r) => r.pdps))).toBe(200);
      // fetch 는 무기마다 한 번씩만(bow2 는 캐시 히트)
      expect(calls).toEqual([
        "https://skekdi4561.github.io/poe2-bow/latest.json",
        "https://skekdi4561.github.io/poe2-bow/latest.crossbow.json",
      ]);
    } finally {
      globalThis.fetch = orig;
    }
  });
});

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

describe("metricRows", () => {
  // 물리 전용 초저가 활이 "원소" 지표에서 0 DPS 계단으로 새면 안 된다 (index.html v.d>0 동일)
  const rows: RichRow[] = [
    { pdps: 300, edps: 0, p: 1, t: 0, offs: {} },
    { pdps: 100, edps: 80, p: 5, t: 0, offs: {} },
  ];
  it("선택 지표가 0인 행은 제외", () => {
    expect(metricRows(rows, "ele")).toEqual([{ d: 80, p: 5, t: 0 }]);
    expect(metricRows(rows, "phys")).toHaveLength(2);
    expect(metricRows(rows, "total")).toHaveLength(2);
  });
});

describe("rowsFromSnapshot", () => {
  const rates = { exalted: 1, divine: 300 };
  const fb = new Set<string>();
  const now = 1_000_000_000_000;
  it("문자열/비숫자 pdps 는 숫자 강제 — frontier 오염 방지", () => {
    const snap = {
      taken_at: now,
      bows: [
        // pdps 가 문자열 "227" 이면 예전엔 pdps+edps 가 "22738" 로 결합됐다
        { rarity: "Rare", cur: "divine", price: 5, t: now, pdps: "227" as unknown as number, edps: 38 },
        { rarity: "Rare", cur: "divine", price: 9, t: now, pdps: 300, edps: 0 },
      ],
    };
    const { rows } = rowsFromSnapshot(snap, rates, fb, now);
    for (const r of rows) {
      expect(typeof r.pdps).toBe("number");
      expect(typeof r.edps).toBe("number");
      expect(Number.isFinite(r.pdps + r.edps)).toBe(true);
    }
    // "227" → 0 강제되어 edps 38 만 남음, 두 번째는 300
    expect(rows.map((r) => r.pdps + r.edps).sort((a, b) => a - b)).toEqual([38, 300]);
  });
  it("가격/DPS 가 0·음수·비정상이면 제외", () => {
    const snap = {
      taken_at: now,
      bows: [
        { rarity: "Rare", cur: "divine", price: 0, t: now, pdps: 100, edps: 0 },
        { rarity: "Rare", cur: "divine", price: 5, t: now, pdps: 0, edps: 0 },
        { rarity: "Rare", cur: "divine", price: "x" as unknown as number, t: now, pdps: 100, edps: 0 },
      ],
    };
    expect(rowsFromSnapshot(snap, rates, fb, now).rows).toHaveLength(0);
  });
});

describe("rowsFromSnapshot staleKept", () => {
  const rates = { exalted: 1, divine: 300 };
  const fb = new Set<string>();
  const now = 2_000_000_000_000;
  const mk = (t: number) => ({ rarity: "Rare", cur: "divine", price: 5, pdps: 300, edps: 0, t });
  it("신선분 부족 시 낡은 매물로 폴백하고 staleKept=true", () => {
    const snap = { taken_at: now, bows: [mk(now - 30 * 3600 * 1000), mk(now - 40 * 3600 * 1000)] };
    const r = rowsFromSnapshot(snap, rates, fb, now);
    expect(r.rows.length).toBe(2);
    expect(r.staleKept).toBe(true);
  });
  it("신선분 충분하면 staleKept=false, 낡은 건 제외", () => {
    const snap = { taken_at: now, bows: [mk(now - 1000), mk(now - 2000), mk(now - 40 * 3600 * 1000)] };
    const r = rowsFromSnapshot(snap, rates, fb, now);
    expect(r.rows.length).toBe(2);
    expect(r.staleKept).toBe(false);
  });
});

describe("optRank (옵션 표시 순서)", () => {
  it("무기 성능 직결이 위, 반려수는 아래 — 감정소 index.html 과 같은 규칙", () => {
    expect(optRank("모든 투사체 스킬 레벨 #")).toBe(0);
    expect(optRank("치명타 확률 #%")).toBe(0);
    expect(optRank("물리 공격 피해의 #%를 생명력으로 흡수")).toBe(0);
    expect(optRank("정확도 #")).toBe(1);
    expect(optRank("반려수의 공격 속도 #% 증가")).toBe(2);
  });
  it("statOptions 가 빈도보다 유용도를 먼저 본다", () => {
    const rows: RichRow[] = [];
    // 반려수 옵션이 더 흔해도(3) 스킬 레벨(2)보다 아래여야 한다
    for (let i = 0; i < 3; i++)
      rows.push({ pdps: 1, edps: 0, p: 1, t: 0, offs: { "반려수의 공격 속도 #% 증가": 10 } });
    for (let i = 0; i < 2; i++)
      rows[i].offs["모든 투사체 스킬 레벨 #"] = 2;
    const s = statOptions(rows);
    expect(s[0].key).toBe("모든 투사체 스킬 레벨 #");
  });
});
