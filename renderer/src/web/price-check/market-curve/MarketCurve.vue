<template>
  <div v-if="verdict" class="layout-column bg-gray-800 rounded px-4 py-3 mb-4">
    <div class="flex items-baseline justify-between">
      <span class="text-gray-400">시장 곡선 판정</span>
      <span class="text-xs text-gray-500"
        >매물 {{ verdict.sample }}개 ·
        {{ verdict.ageHours < 1 ? "방금 전" : `${Math.round(verdict.ageHours)}시간 전`
        }}<template v-if="verdict.rateFallback"> · 환율 일부 기본값</template></span
      >
    </div>
    <div class="mt-1">
      총 DPS <span class="font-bold">{{ Math.round(verdict.totalDps) }}</span>
      <span class="text-gray-500 text-sm">
        (물리 {{ Math.round(verdict.physDps) }} · 원소
        {{ Math.round(verdict.eleDps) }})</span
      >
    </div>
    <div v-if="verdict.notRare" class="text-yellow-500 text-sm">
      ※ 희귀 등급이 아님 — 곡선은 희귀 기준입니다
    </div>
    <div v-if="verdict.aboveMarket" class="mt-1">
      시장 관측 최고 DPS({{ Math.round(verdict.aboveMarket) }})보다 높음 — 비교
      대상 없음
    </div>
    <template v-else>
      <div v-if="verdict.floor" class="mt-1">
        이 DPS 시장 최저가:
        <span class="font-bold text-yellow-300">{{ verdict.floor.price }}</span>
      </div>
      <div v-if="verdict.next" class="text-sm text-gray-400">
        한 계단 위: DPS {{ Math.round(verdict.next.dps) }} 부터
        {{ verdict.next.price }}
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType, shallowRef, watch } from "vue";
import { ParsedItem } from "@/parser";
import { appraise, isBow, CurveVerdict } from "./appraiser";

export default defineComponent({
  name: "MarketCurve",
  props: {
    item: {
      type: Object as PropType<ParsedItem>,
      required: true,
    },
  },
  setup(props) {
    const verdict = shallowRef<CurveVerdict | null>(null);
    watch(
      () => props.item,
      async (item) => {
        verdict.value = null;
        if (!isBow(item)) return;
        const got = await appraise(item);
        if (got && props.item === item) verdict.value = got; // 아이템이 바뀌었으면 버린다
      },
      { immediate: true },
    );
    return { verdict };
  },
});
</script>
