<template>
  <Widget :config="config" move-handles="center" :inline-edit="false">
    <div class="widget-default-style p-3 text-gray-100" style="width: 24rem">
      <div class="flex items-baseline justify-between mb-2">
        <span class="font-bold">활 시세 감정소</span>
        <span v-if="board" class="text-xs text-gray-400"
          >매물 {{ filtered.length }}/{{ board.sample }}개 ·
          {{ board.ageHours < 1 ? "방금 전" : Math.round(board.ageHours) + "시간 전"
          }}<template v-if="board.rateFallback"> · 환율 일부 기본값</template></span
        >
      </div>

      <div v-if="loading" class="text-gray-400 text-sm py-4 text-center">
        시세 불러오는 중…
      </div>
      <div v-else-if="!board" class="text-gray-400 text-sm py-4 text-center">
        시세 데이터를 불러오지 못했습니다
      </div>

      <template v-else>
        <!-- 지표 + 정렬 -->
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
          <button
            @click="sortDesc = !sortDesc"
            class="ml-auto px-2 py-0.5 rounded bg-gray-900 text-gray-400"
          >
            {{ sortDesc ? "DPS 높은 순" : "DPS 낮은 순" }}
          </button>
        </div>

        <!-- 예산 -->
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm text-gray-400">예산</span>
          <input
            v-model.number="budget"
            type="number"
            min="0"
            placeholder="0"
            class="bg-gray-900 rounded px-2 py-1 w-20 text-right"
          />
          <span class="text-sm text-gray-400">ex</span>
          <span v-if="best" class="text-sm ml-auto"
            >이 예산 최고 DPS
            <span class="font-bold text-yellow-300">{{ Math.round(best.d) }}</span></span
          >
          <span
            v-else-if="typeof budget === 'number' && budget > 0"
            class="text-sm ml-auto text-gray-500"
            >예산 내 매물 없음</span
          >
        </div>

        <!-- 조건 칩 (다중 선택) -->
        <div class="mb-2">
          <div class="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>조건 (겹쳐서 선택 가능)</span>
            <button v-if="picked.size" @click="picked.clear()" class="text-gray-400 underline">
              전체 해제
            </button>
          </div>
          <div class="flex flex-wrap gap-1 overflow-y-auto" style="max-height: 7rem">
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

        <!-- 최전선 계단 -->
        <div class="overflow-y-auto" style="max-height: 13rem">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-gray-500 text-xs">
                <td class="pb-1">DPS</td>
                <td class="pb-1 text-right">최저가</td>
              </tr>
            </thead>
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
          희귀 활 즉시구매 매물 기준 · 24시간 이내 수집분
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
      } else {
        wm.hide(props.config.wmId);
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
      const affordable = front.value.filter((r) => r.p <= (budget.value as number));
      return affordable.length ? affordable[affordable.length - 1] : null;
    });

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
    };
  },
});
</script>
