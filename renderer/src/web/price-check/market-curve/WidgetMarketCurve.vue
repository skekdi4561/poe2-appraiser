<template>
  <Widget :config="config" move-handles="center" :inline-edit="false">
    <div
      class="widget-default-style p-5 text-gray-100 rounded-lg"
      style="width: 48rem"
    >
      <!-- 헤더 -->
      <div class="flex items-baseline justify-between mb-3">
        <span class="font-bold text-lg"
          ><span class="text-yellow-500">활 시세</span> 감정소</span
        >
        <span v-if="board" class="text-sm text-gray-400"
          >매물 {{ filtered.length }}/{{ board.sample }}개 ·
          {{ board.ageHours < 1 ? "방금 전" : Math.round(board.ageHours) + "시간 전"
          }}<template v-if="board.rateFallback"> · 환율 일부 기본값</template></span
        >
      </div>

      <div v-if="loading" class="text-gray-400 py-12 text-center">
        시세 불러오는 중…
      </div>
      <div v-else-if="!board" class="text-gray-400 py-12 text-center">
        시세 데이터를 불러오지 못했습니다
      </div>

      <template v-else>
        <!-- 지표 · 예산 -->
        <div class="flex items-center gap-2 mb-3">
          <div class="flex bg-gray-900 rounded p-0.5">
            <button
              v-for="m in metrics"
              :key="m.id"
              @click="metric = m.id"
              class="px-3 py-1 rounded"
              :class="
                metric === m.id
                  ? 'bg-gray-600 text-white font-medium'
                  : 'text-gray-400 hover:text-gray-200'
              "
            >
              {{ m.label }}
            </button>
          </div>
          <span class="ml-3 text-gray-400">예산</span>
          <input
            v-model.number="budget"
            type="number"
            min="0"
            placeholder="0"
            class="bg-gray-900 rounded px-2 py-1 w-24 text-right"
            style="font-variant-numeric: tabular-nums"
          />
          <select
            v-model="budgetCur"
            class="bg-gray-900 rounded px-2 py-1 text-gray-200"
          >
            <option v-for="c in currencies" :key="c.id" :value="c.id">
              {{ c.label }}
            </option>
          </select>
          <span v-if="best" class="ml-auto"
            >이 예산 최고 DPS
            <span class="font-bold text-teal-400 text-lg">{{
              Math.round(best.d)
            }}</span>
            · {{ formatEx(best.p, board.rates) }}</span
          >
          <span v-else-if="budgetEx > 0" class="ml-auto text-gray-500"
            >예산 내 매물 없음</span
          >
        </div>

        <!-- 시장 곡선 차트 -->
        <div class="relative mb-3">
          <canvas
            ref="canvasEl"
            class="w-full rounded border border-gray-700 bg-gray-900"
            style="height: 20rem"
            @mousemove="onHover"
            @mouseleave="hover = null"
          ></canvas>
          <div
            v-if="hover"
            class="absolute pointer-events-none bg-gray-950 border border-gray-600 rounded px-2 py-1 text-sm shadow-lg"
            :style="{ left: hover.left + 'px', top: hover.top + 'px' }"
            style="font-variant-numeric: tabular-nums"
          >
            DPS {{ Math.round(hover.d) }} ·
            <span class="text-yellow-400 font-bold">{{
              formatEx(hover.p, board.rates)
            }}</span>
          </div>
        </div>

        <!-- 아래 2단: 조건 필터 | 최전선 표 -->
        <div class="flex gap-4">
          <!-- 조건 필터 (거래소식 자유 필터) -->
          <div class="flex-1 min-w-0">
            <div
              class="text-gray-500 mb-1.5"
              style="font-size: 12px; letter-spacing: 0.05em"
            >
              조건 필터 — 옵션을 검색해 추가하고 수치를 직접 입력
            </div>

            <!-- 옵션 검색 -->
            <div class="relative mb-2">
              <input
                v-model="query"
                @focus="showDrop = true"
                @blur="hideDropSoon"
                type="text"
                placeholder="+ 옵션 검색 (예: 치명타, 생명력, 화살)"
                class="w-full bg-gray-900 rounded px-3 py-1.5 border border-gray-700 focus:border-gray-500"
              />
              <div
                v-if="showDrop && matchedStats.length"
                class="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-gray-950 border border-gray-600 rounded shadow-lg"
              >
                <button
                  v-for="s in matchedStats"
                  :key="s.key"
                  @mousedown.prevent="addFilter(s)"
                  class="w-full text-left px-3 py-1.5 hover:bg-gray-800 flex justify-between gap-2"
                >
                  <span class="truncate">{{ s.key }}</span>
                  <span class="text-gray-500 whitespace-nowrap text-sm"
                    >{{ s.n }}개 · {{ s.lo }}~{{ s.hi }}</span
                  >
                </button>
              </div>
            </div>

            <!-- 추가된 필터 행들 -->
            <div v-if="!filters.length" class="text-gray-600 text-sm py-2">
              필터 없음 — 전체 매물 기준
            </div>
            <div
              v-for="(f, i) in filters"
              :key="f.key + i"
              class="flex items-center gap-2 mb-1.5 bg-gray-900 rounded px-2 py-1.5 border border-gray-800"
            >
              <span class="flex-1 truncate" :title="f.key">{{ f.key }}</span>
              <input
                v-model.number="f.min"
                type="number"
                placeholder="최소"
                class="w-20 bg-gray-950 rounded px-2 py-0.5 text-right border border-gray-700"
                style="font-variant-numeric: tabular-nums"
              />
              <span class="text-gray-600">~</span>
              <input
                v-model.number="f.max"
                type="number"
                placeholder="최대"
                class="w-20 bg-gray-950 rounded px-2 py-0.5 text-right border border-gray-700"
                style="font-variant-numeric: tabular-nums"
              />
              <button
                @click="filters.splice(i, 1)"
                class="text-gray-500 hover:text-red-400 px-1"
                title="제거"
              >
                ✕
              </button>
            </div>
            <button
              v-if="filters.length"
              @click="filters.splice(0)"
              class="text-sm text-gray-400 hover:text-gray-200 underline"
            >
              전체 해제
            </button>
          </div>

          <!-- 최전선 표 -->
          <div style="width: 15rem">
            <div class="flex items-center justify-between mb-1.5">
              <span
                class="text-gray-500"
                style="font-size: 12px; letter-spacing: 0.05em"
                >가격 최전선</span
              >
              <button
                @click="sortDesc = !sortDesc"
                class="text-sm text-gray-400 hover:text-gray-200 underline"
              >
                {{ sortDesc ? "DPS 높은 순" : "DPS 낮은 순" }}
              </button>
            </div>
            <div
              class="overflow-y-auto rounded border border-gray-700 bg-gray-900"
              style="max-height: 15rem"
            >
              <table
                class="w-full"
                style="font-variant-numeric: tabular-nums"
              >
                <tbody>
                  <tr v-if="front.length < 2">
                    <td colspan="2" class="text-gray-500 text-center py-3 text-sm">
                      이 조건은 매물이 부족합니다
                    </td>
                  </tr>
                  <tr
                    v-for="(r, i) in rungs"
                    :key="i"
                    class="border-b border-gray-800 last:border-0 hover:bg-gray-800"
                    :class="{ 'text-teal-400 font-bold': best && r.d === best.d }"
                  >
                    <td class="py-1 px-2">{{ Math.round(r.d) }}</td>
                    <td class="py-1 px-2 text-right">
                      {{ formatEx(r.p, board.rates) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="text-sm text-gray-500 mt-3">
          희귀 활 즉시구매 매물 기준 · 24시간 이내 수집분 · 가격축 로그 스케일
        </div>
      </template>
    </div>
  </Widget>
</template>

<script lang="ts">
import {
  defineComponent,
  PropType,
  inject,
  ref,
  reactive,
  computed,
  watch,
  nextTick,
} from "vue";
import Widget from "@/web/overlay/Widget.vue";
import { Host } from "@/web/background/IPC";
import type { WidgetManager, WidgetSpec } from "@/web/overlay/interfaces";
import type { MarketCurveWidget } from "@/web/overlay/interfaces";
import {
  marketBoard,
  frontier,
  formatEx,
  matchesFilters,
  metricRows,
  MarketBoard,
  StatOption,
  StatFilter,
  Row,
} from "./appraiser";

export default defineComponent({
  widget: {
    type: "market-curve",
    instances: "single",
    trNameKey: "market_curve.name",
    initInstance: (): MarketCurveWidget => ({
      wmId: 0,
      wmType: "market-curve",
      wmTitle: "",
      wmWants: "hide",
      wmZorder: null,
      wmFlags: [],
      anchor: { pos: "cc", x: 50, y: 50 },
      toggleKey: "F7",
    }),
  } satisfies WidgetSpec,
  components: { Widget },
  props: {
    config: {
      type: Object as PropType<MarketCurveWidget>,
      required: true,
    },
  },
  setup(props) {
    const wm = inject<WidgetManager>("wm")!;

    // 브라우저 미리보기 전용 훅 — ?web-preview&show-curve 로 열면 즉시 표시
    if (!Host.isElectron && window.location.search.includes("show-curve")) {
      wm.show(props.config.wmId);
    }

    Host.onEvent("MAIN->CLIENT::widget-action", (e) => {
      if (e.target !== "market-curve") return;
      if (props.config.wmWants === "hide") {
        wm.show(props.config.wmId);
        // 토글 키로 열면 오버레이가 클릭 통과 상태라 조작이 안 된다 — 입력 포커스를 요청
        Host.sendEvent({
          name: "OVERLAY->MAIN::focus-overlay",
          payload: undefined,
        });
      } else {
        wm.hide(props.config.wmId);
        Host.sendEvent({
          name: "OVERLAY->MAIN::focus-game",
          payload: undefined,
        });
      }
    });

    const board = ref<MarketBoard | null>(null);
    const loading = ref(false);
    const metric = ref<"total" | "phys" | "ele">("total");
    const metrics = [
      { id: "total" as const, label: "총 DPS" },
      { id: "phys" as const, label: "물리" },
      { id: "ele" as const, label: "원소" },
    ];
    const sortDesc = ref(true);

    // 예산 — 통화 선택 가능, 내부 비교는 전부 엑잘 기준
    const budget = ref<number | "">("");
    const budgetCur = ref<"exalted" | "chaos" | "divine" | "annul">("exalted");
    const currencies = [
      { id: "exalted" as const, label: "엑잘" },
      { id: "divine" as const, label: "디바인" },
      { id: "chaos" as const, label: "카오스" },
      { id: "annul" as const, label: "소멸" },
    ];
    const budgetEx = computed(() => {
      if (typeof budget.value !== "number" || budget.value <= 0) return 0;
      const r = board.value?.rates[budgetCur.value] ?? 0;
      return r > 0 ? budget.value * r : 0;
    });

    // 거래소식 자유 필터
    const filters = reactive<StatFilter[]>([]);
    const query = ref("");
    const showDrop = ref(false);
    function hideDropSoon() {
      setTimeout(() => (showDrop.value = false), 150);
    }
    const matchedStats = computed<StatOption[]>(() => {
      if (!board.value) return [];
      const q = query.value.trim().toLowerCase();
      const used = new Set(filters.map((f) => f.key));
      const pool = board.value.stats.filter((s) => !used.has(s.key));
      if (!q) return pool.slice(0, 20); // 비어 있으면 자주 보이는 옵션 순
      return pool.filter((s) => s.key.toLowerCase().includes(q)).slice(0, 20);
    });
    function addFilter(s: StatOption) {
      filters.push({ key: s.key, min: null, max: null });
      query.value = "";
      showDrop.value = false;
    }

    async function load() {
      loading.value = true;
      board.value = await marketBoard(); // 10분 캐시라 매번 불러도 싸다
      loading.value = false;
    }
    watch(
      () => props.config.wmWants,
      (wants) => {
        if (wants === "show") load();
      },
      { immediate: true },
    );

    // v-model.number 는 빈 입력을 "" 로 만든다 — null 로 정규화
    const normFilters = computed<StatFilter[]>(() =>
      filters.map((f) => ({
        key: f.key,
        min: typeof f.min === "number" ? f.min : null,
        max: typeof f.max === "number" ? f.max : null,
      })),
    );
    const filtered = computed(() => {
      if (!board.value) return [];
      if (!normFilters.value.length) return board.value.rows;
      return board.value.rows.filter((r) =>
        matchesFilters(r.offs, normFilters.value),
      );
    });
    const front = computed<Row[]>(() =>
      frontier(metricRows(filtered.value, metric.value)),
    );
    // frontier 는 DPS 오름차순 — 표시 정렬만 뒤집는다
    const rungs = computed(() =>
      sortDesc.value ? [...front.value].reverse() : front.value,
    );
    const best = computed(() => {
      if (budgetEx.value <= 0) return null;
      const affordable = front.value.filter((r) => r.p <= budgetEx.value);
      return affordable.length ? affordable[affordable.length - 1] : null;
    });

    // ---------- 차트 ----------
    const canvasEl = ref<HTMLCanvasElement | null>(null);
    const hover = ref<{ left: number; top: number; d: number; p: number } | null>(
      null,
    );
    let chartScale: { X: (d: number) => number } | null = null;

    const PAD = { l: 60, r: 18, t: 12, b: 24 };
    const GOLD = "#eab308";
    const TEAL = "#2dd4bf";

    // 눈금 라벨 — "25.0 div" 대신 "25 div" 처럼 군더더기 없이
    function fmtTick(pEx: number, rates: Record<string, number>): string {
      const dv = rates["divine"] ?? 0;
      const useDiv = dv > 1 && pEx >= dv;
      const v = useDiv ? pEx / dv : pEx;
      const s =
        v >= 10 || Number.isInteger(v) ? String(Math.round(v)) : v.toFixed(1);
      return s + (useDiv ? " div" : " ex");
    }

    // DPS 눈금을 보기 좋은 단위(10/25/50/100…)로
    function niceTicks(min: number, max: number, want: number): number[] {
      const span = max - min || 1;
      const raw = span / want;
      const mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step =
        [1, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= want) ??
        10 * mag;
      const out: number[] = [];
      for (let v = Math.ceil(min / step) * step; v <= max; v += step)
        out.push(v);
      return out;
    }

    function draw() {
      const cv = canvasEl.value;
      if (!cv || !board.value) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const ctx = cv.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);
      ctx.font = "12px sans-serif";

      const f = front.value;
      if (f.length < 2) {
        chartScale = null;
        ctx.fillStyle = "#6b7280";
        ctx.textAlign = "center";
        ctx.fillText("이 조건은 매물이 부족합니다", W / 2, H / 2);
        return;
      }

      const xmin = f[0].d;
      const xmax = f[f.length - 1].d;
      const lo = Math.log10(f[0].p);
      const hi = Math.log10(f[f.length - 1].p);
      const X = (d: number) =>
        PAD.l + ((d - xmin) / (xmax - xmin || 1)) * (W - PAD.l - PAD.r);
      const Y = (p: number) =>
        H -
        PAD.b -
        ((Math.log10(p) - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
      chartScale = { X };

      // 가격 눈금 (10의 거듭제곱)
      ctx.strokeStyle = "rgba(107,114,128,0.2)";
      ctx.fillStyle = "#9ca3af";
      ctx.textAlign = "right";
      ctx.lineWidth = 1;
      for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
        const p = Math.pow(10, k);
        const y = Y(p);
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(W - PAD.r, y);
        ctx.stroke();
        ctx.fillText(fmtTick(p, board.value.rates), PAD.l - 6, y + 3);
      }
      // DPS 눈금 (보기 좋은 단위)
      ctx.textAlign = "center";
      for (const d of niceTicks(xmin, xmax, 8)) {
        const x = X(d);
        ctx.beginPath();
        ctx.moveTo(x, PAD.t);
        ctx.lineTo(x, H - PAD.b);
        ctx.stroke();
        ctx.fillText(String(Math.round(d)), x, H - 8);
      }
      // 축선
      ctx.strokeStyle = "rgba(156,163,175,0.5)";
      ctx.beginPath();
      ctx.moveTo(PAD.l, PAD.t);
      ctx.lineTo(PAD.l, H - PAD.b);
      ctx.lineTo(W - PAD.r, H - PAD.b);
      ctx.stroke();

      // 계단 경로 (아래 채움 + 금색 선)
      const path = new Path2D();
      path.moveTo(X(f[0].d), Y(f[0].p));
      for (let i = 1; i < f.length; i++) {
        path.lineTo(X(f[i].d), Y(f[i - 1].p));
        path.lineTo(X(f[i].d), Y(f[i].p));
      }
      const fill = new Path2D(path);
      fill.lineTo(X(xmax), H - PAD.b);
      fill.lineTo(X(xmin), H - PAD.b);
      fill.closePath();
      const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
      grad.addColorStop(0, "rgba(234,179,8,0.18)");
      grad.addColorStop(1, "rgba(234,179,8,0.03)");
      ctx.fillStyle = grad;
      ctx.fill(fill);
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke(path);

      // 계단 꼭짓점
      ctx.fillStyle = GOLD;
      for (const r of f) {
        ctx.beginPath();
        ctx.arc(X(r.d), Y(r.p), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 호버 십자선 + 강조점
      if (hover.value) {
        const hx = X(hover.value.d);
        const hy = Y(hover.value.p);
        ctx.strokeStyle = "rgba(156,163,175,0.45)";
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(hx, PAD.t);
        ctx.lineTo(hx, H - PAD.b);
        ctx.moveTo(PAD.l, hy);
        ctx.lineTo(W - PAD.r, hy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#fde047";
        ctx.beginPath();
        ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 예산선 + 최적점
      if (budgetEx.value > 0) {
        const b = budgetEx.value;
        if (Math.log10(b) >= lo && Math.log10(b) <= hi) {
          ctx.strokeStyle = TEAL;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(PAD.l, Y(b));
          ctx.lineTo(W - PAD.r, Y(b));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (best.value) {
          ctx.fillStyle = TEAL;
          ctx.beginPath();
          ctx.arc(X(best.value.d), Y(best.value.p), 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#0f172a";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
    }

    function onHover(ev: MouseEvent) {
      const cv = canvasEl.value;
      if (!cv || !chartScale || front.value.length < 2) {
        hover.value = null;
        return;
      }
      const rect = cv.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      // 마우스 x 에 가장 가까운 계단 꼭짓점
      let nearest = front.value[0];
      let bestDist = Infinity;
      for (const r of front.value) {
        const dist = Math.abs(chartScale.X(r.d) - mx);
        if (dist < bestDist) {
          bestDist = dist;
          nearest = r;
        }
      }
      hover.value = {
        left: Math.min(chartScale.X(nearest.d) + 12, rect.width - 170),
        top: Math.max(ev.clientY - rect.top - 32, 4),
        d: nearest.d,
        p: nearest.p,
      };
    }

    watch([front, budgetEx, board, hover], () => nextTick(draw), {
      flush: "post",
    });
    watch(
      () => props.config.wmWants,
      () => nextTick(draw),
      { flush: "post" },
    );

    return {
      board,
      loading,
      metric,
      metrics,
      sortDesc,
      budget,
      budgetCur,
      currencies,
      budgetEx,
      filters,
      query,
      showDrop,
      hideDropSoon,
      matchedStats,
      addFilter,
      filtered,
      front,
      rungs,
      best,
      formatEx,
      canvasEl,
      hover,
      onHover,
    };
  },
});
</script>
