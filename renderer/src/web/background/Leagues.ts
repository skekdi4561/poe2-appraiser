import { computed, shallowRef, readonly } from "vue";
import { createGlobalState } from "@vueuse/core";
import { AppConfig, poeWebApi } from "@/web/Config";
import { Host } from "./IPC";

// pc-ggg, pc-garena
// const PERMANENT_SC = ['Standard', '標準模式']
// const PERMANENT_HC = ["Hardcore", "專家模式"];

interface TradeLeague {
  id: string;
  text: string;
}

interface League {
  id: string;
  isPopular: boolean;
  text: string;
}

export const useLeagues = createGlobalState(() => {
  const isLoading = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const tradeLeagues = shallowRef<League[]>([]);

  const selectedId = computed<string | undefined>({
    get() {
      return tradeLeagues.value.length ? AppConfig().leagueId : undefined;
    },
    set(id) {
      AppConfig().leagueId = id;
    },
  });

  const selected = computed(() => {
    const { leagueId } = AppConfig();
    if (!tradeLeagues.value || !leagueId) return undefined;
    const listed = tradeLeagues.value.find((league) => league.id === leagueId);
    return {
      id: leagueId,
      realm: AppConfig().realm,
      isPopular: !isPrivateLeague(leagueId) && Boolean(listed?.isPopular),
    };
  });

  async function load() {
    isLoading.value = true;
    error.value = null;

    try {
      // TODO: swap back to /api/leagues?realm=poe2 when available (allows detection of Hardcore leagues)
      const response = await Host.proxy(
        `${poeWebApi()}/api/trade2/data/leagues`,
      );
      if (!response.ok)
        throw new Error(JSON.stringify(Object.fromEntries(response.headers)));
      const leagues: { result: TradeLeague[] } = await response.json();
      tradeLeagues.value = leagues.result.map((league) => {
        return { id: league.id, isPopular: true, text: league.text };
      });

      const leagueIsAlive = tradeLeagues.value.some(
        (league) => league.id === selectedId.value,
      );
      // 고른 리그가 없거나(첫 실행·마이그레이션으로 비움) 끝난 리그면 도전 리그를 고른다.
      if (
        (!selectedId.value || !leagueIsAlive) &&
        !isPrivateLeague(selectedId.value ?? "")
      ) {
        selectedId.value = pickChallengeLeague(tradeLeagues.value);
      }
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isLoading,
    error,
    selectedId,
    selected,
    list: readonly(tradeLeagues),
    load,
  };
});

// 그 시즌의 도전 리그를 고른다 — 목록에서 상시 리그(Standard/Hardcore)와 비공개 리그를
// 뺀 첫 항목. 자리(인덱스)로 찍지 않으므로 **시즌이 바뀌어도 앱 수정이 필요 없다**
// (예전 코드는 TMP_CHALLENGE = 2 라는 고정 인덱스를 썼다).
// 감정소 시세가 도전 리그 기준이라 기본값도 거기에 맞춘다.
const PERMANENT_LEAGUES = ["Standard", "Hardcore"];
function pickChallengeLeague(list: League[]): string | undefined {
  const challenge = list.find(
    (l) =>
      !PERMANENT_LEAGUES.includes(l.id) &&
      !isPrivateLeague(l.id) &&
      !l.id.includes("SSF"),
  );
  return (challenge ?? list[0])?.id;
}

function isPrivateLeague(id: string) {
  if (id.includes("Ruthless")) {
    return true;
  }
  return /\(PL\d+\)$/.test(id);
}
