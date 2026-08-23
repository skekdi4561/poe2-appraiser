<template>
  <Widget :config="config" move-handles="center" :inline-edit="false">
    <div class="widget-default-style p-3 text-gray-100" style="width: 19rem">
      <div class="flex items-baseline justify-between mb-2">
        <span class="font-bold">활 시세 감정소</span>
        <span v-if="board" class="text-xs text-gray-400"
          >매물 {{ board.sample }}개 ·
          {{ board.ageHours < 1 ? "방금 전" : `${Math.round(board.ageHours)}시간 전`
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
            >최고 DPS <span class="font-bold text-yellow-300">{{
              Math.round(best.d)
            }}</span></span
          >
        </div>
        <div class="overflow-y-auto" style="max-height: 16rem">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-gray-500 text-xs">
                <td class="pb-1">DPS</td>
                <td class="pb-1 text-right">최저가</td>
              </tr>
            </thead>
            <tbody>
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
  computed,
  watch,
} from "vue";
import Widget from "@/web/overlay/Widget.vue";
import { Host } from "@/web/background/IPC";
import type { WidgetManager, WidgetSpec } from "@/web/overlay/interfaces";
import type { MarketCurveWidget } from "@/web/overlay/interfaces";
import { marketFrontier, formatEx, MarketBoard } from "./appraiser";

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

    async function load() {
      loading.value = true;
      board.value = await marketFrontier(); // 10분 캐시라 매번 불러도 싸다
      loading.value = false;
    }

    watch(
      () => props.config.wmWants,
      (wants) => {
        if (wants === "show") load();
      },
      { immediate: true },
    );

    // 높은 DPS 가 위로 오게 뒤집어 보여준다
    const rungs = computed(() =>
      board.value ? [...board.value.front].reverse() : [],
    );
    const best = computed(() => {
      if (!board.value || typeof budget.value !== "number" || budget.value <= 0)
        return null;
      const affordable = board.value.front.filter(
        (r) => r.p <= (budget.value as number),
      );
      return affordable.length ? affordable[affordable.length - 1] : null;
    });

    return { board, loading, budget, rungs, best, formatEx };
  },
});
</script>
