<template>
  <Widget :config="config" move-handles="center" :inline-edit="false">
    <div class="widget-default-style p-4 text-gray-100" style="width: 34rem">
      <div class="flex items-baseline justify-between mb-2">
        <span class="font-bold text-base">활 시세 감정소</span>
        <span v-if="board" class="text-xs text-gray-400"
          >매물 {{ filtered.length }}/{{ board.sample }}개 ·
          {{ board.ageHours < 1 ? "방금 전" : Math.round(board.ageHours) + "시간 전"
          }}<template v-if="board.rateFallback"> · 환율 일부 기본값</template></span
        >
      </div>

      <div v-if="loading" class="text-gray-400 text-sm py-8 text-center">
        시세 불러오는 중…
      </div>
      <div v-else-if="!board" class="text-gray-400 text-sm py-8 text-center">
        시세 데이터를 불러오지 못했습니다
      </div>

      <template v-else>
        <!-- 지표 · 예산 · 정렬 -->
        <div class="flex items-center gap-1 mb-2 text-sm">
          <button
            v-for="m in metrics"
            :key="m.id"
            @click="metric = m.id"
            class="px-2 py-0.5 rounded"
            :class="metric === m.id ? 'bg-gray-600 font-bold' : 'bg-gray-900 text-gray-400'"
          >
            {{ m.label }}
          </button>
          <span class="ml-3 text-gray-400">예산</span>
          <input
            v-model.number="budget"
            type="number"
            min="0"
            placeholder="0"
            class="bg-gray-900 rounded px-2 py-0.5 w-20 text-right"
          />
          <span class="text-gray-400">ex</span>
          <span v-if="best" class="ml-auto"
            >이 예산 최고 DPS
            <span class="font-bold text-yellow-300">{{ Math.round(best.d) }}</span></span
          >
          <span
            v-else-if="typeof budget === 'number' && budget > 0"
            class="ml-auto text-gray-500"
            >예산 내 매물 없음</span
          >
        </div>

        <!-- 시장 곡선 차트 -->
        <div class="relative mb-2">
          <canvas
            ref="canvasEl"
            class="w-full rounded bg-gray-900"
            style="height: 15rem"
            @mousemove="onHover"
            @mouseleave="hover = null"
          ></canvas>
          <div
            v-if="hover"
            class="absolute pointer-events-none bg-gray-700 rounded px-2 py-1 text-xs shadow"
            :style="{ left: hover.left + 'px', top: hover.top + 'px' }"
          >
            DPS {{ Math.round(hover.d) }} —
            <span class="text-yellow-300 font-bold">{{
              formatEx(hover.p, board.rates)
            }}</span>
          </div>
        </div>

        <!-- 조건 칩 (다중 선택) -->
        <div class="mb-2">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>조건 (겹쳐서 선택 가능)</span>
            <button
              v-if="picked.size"
              @click="picked.clear()"
              class="text-gray-400 underline"
            >
              전체 해제
            </button>
          </div>
          <div class="flex flex-wrap gap-1 overflow-y-auto" style="max-height: 6rem">
            <button
              v-for="c in board.conds"
              :key="c.key + '|' + c.min"
              @click="toggleCond(c)"
              class="px-2 py-0.5 rounded text-xs"
              :class="
                picked.has(c.key + '|' + c.min)
                  ? 'bg-yellow-700 text-white'
                  : 'bg-gray-900 text-gray-300'
              "
            >
              {{ c.label }} <span class="text-gray-500">{{ c.n }}</span>
            </button>
          </div>
        </div>

        <!-- 최전선 표 -->
        <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
          <span>가격 최전선 (이 DPS 를 사는 최저가)</span>
          <button @click="sortDesc = !sortDesc" class="text-gray-400 underline">
            {{ sortDesc ? "DPS 높은 순" : "DPS 낮은 순" }}
          </button>
        </div>
        <div class="overflow-y-auto rounded bg-gray-900 px-2 py-1" style="max-height: 9rem">
          <table class="w-full text-sm" style="font-variant-numeric: tabular-nums">
            <tbody>
              <tr v-if="front.length < 2">
                <td colspan="2" class="text-gray-500 text-center py-2">
                  이 조건 조합은 매물이 부족합니다
                </td>
              </tr>
              <tr
                v-for="(r, i) in rungs"
                :key="i"
                :class="{ 'text-yellow-300 font-bold': best && r.d === best.d }"
              >
                <td class="py-px">{{ Math.round(r.d) }}</td>
                <td class="py-px text-right">{{ formatEx(r.p, board.rates) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="text-xs text-gray-500 mt-2">
          희귀 활 즉시구매 매물 기준 · 24시간 이내 수집분 · 세로축 로그 스케일
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
  meetsAll,
  MarketBoard,
  CondChip,
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
    const budget = ref<number | "">("");
    const metric = ref<"total" | "phys" | "ele">("total");
    const metrics = [
      { id: "total" as const, label: "총 DPS" },
      { id: "phys" as const, label: "물리" },
      { id: "ele" as const, label: "원소" },
    ];
    const sortDesc = ref(true);
    const picked = reactive(new Set<string>()); // "key|min"

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

    function toggleCond(c: CondChip) {
      const id = c.key + "|" + c.min;
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
    }

    const preds = computed(() => {
      if (!board.value) return [];
      return board.value.conds.filter((c) => picked.has(c.key + "|" + c.min));
    });
    const filtered = computed(() => {
      if (!board.value) return [];
      if (!preds.value.length) return board.value.rows;
      return board.value.rows.filter((r) => meetsAll(r.offs, preds.value));
    });
    const front = computed<Row[]>(() =>
      frontier(
        filtered.value.map((r) => ({
          d:
            metric.value === "phys"
              ? r.pdps
              : metric.value === "ele"
                ? r.edps
                : r.pdps + r.edps,
          p: r.p,
          t: r.t,
        })),
      ),
    );
    // frontier 는 DPS 오름차순 — 표시 정렬만 뒤집는다
    const rungs = computed(() =>
      sortDesc.value ? [...front.value].reverse() : front.value,
    );
    const best = computed(() => {
      if (typeof budget.value !== "number" || budget.value <= 0) return null;
      const affordable = front.value.filter(
        (r) => r.p <= (budget.value as number),
      );
      return affordable.length ? affordable[affordable.length - 1] : null;
    });

    // ---------- 차트 ----------
    const canvasEl = ref<HTMLCanvasElement | null>(null);
    const hover = ref<{ left: number; top: number; d: number; p: number } | null>(
      null,
    );
    // 화면 좌표 변환을 hover 에서 재사용하려고 보관
    let chartScale: {
      X: (d: number) => number;
      xmin: number;
      xmax: number;
    } | null = null;

    const PAD = { l: 52, r: 14, t: 10, b: 20 };

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
      ctx.font = "11px sans-serif";

      const f = front.value;
      if (f.length < 2) {
        chartScale = null;
        ctx.fillStyle = "#6b7280";
        ctx.textAlign = "center";
        ctx.fillText("이 조건 조합은 매물이 부족합니다", W / 2, H / 2);
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
      chartScale = { X, xmin, xmax };

      // 가로 눈금 (가격, 10의 거듭제곱)
      ctx.strokeStyle = "rgba(107,114,128,0.25)";
      ctx.fillStyle = "#9ca3af";
      ctx.textAlign = "left";
      ctx.lineWidth = 1;
      for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) {
        const y = Y(Math.pow(10, k));
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(W - PAD.r, y);
        ctx.stroke();
        ctx.fillText(formatEx(Math.pow(10, k), board.value.rates), 2, y + 3);
      }
      // 세로 눈금 (DPS, 4등분)
      ctx.textAlign = "center";
      for (let i = 0; i <= 4; i++) {
        const d = xmin + ((xmax - xmin) * i) / 4;
        const x = X(d);
        ctx.beginPath();
        ctx.moveTo(x, PAD.t);
        ctx.lineTo(x, H - PAD.b);
        ctx.stroke();
        ctx.fillText(String(Math.round(d)), x, H - 6);
      }

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
      ctx.fillStyle = "rgba(234,179,8,0.10)";
      ctx.fill(fill);
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 2;
      ctx.stroke(path);

      // 계단 꼭짓점
      ctx.fillStyle = "#eab308";
      for (const r of f) {
        ctx.beginPath();
        ctx.arc(X(r.d), Y(r.p), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 예산선 + 최적점
      if (typeof budget.value === "number" && budget.value > 0) {
        const b = budget.value;
        if (Math.log10(b) >= lo && Math.log10(b) <= hi) {
          ctx.strokeStyle = "#2dd4bf";
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(PAD.l, Y(b));
          ctx.lineTo(W - PAD.r, Y(b));
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (best.value) {
          ctx.fillStyle = "#2dd4bf";
          ctx.beginPath();
          ctx.arc(X(best.value.d), Y(best.value.p), 5, 0, Math.PI * 2);
          ctx.fill();
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
        left: Math.min(chartScale.X(nearest.d) + 10, rect.width - 130),
        top: ev.clientY - rect.top - 28,
        d: nearest.d,
        p: nearest.p,
      };
    }

    watch([front, budget, board], () => nextTick(draw), { flush: "post" });
    watch(
      () => props.config.wmWants,
      () => nextTick(draw),
      { flush: "post" },
    );

    return {
      board,
      loading,
      budget,
      metric,
      metrics,
      sortDesc,
      picked,
      toggleCond,
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
