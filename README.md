# POE2 시세 감정소 (오버레이)

**"이 예산으로 살 수 있는 최고 DPS는?"** — 시장 곡선으로 답하는 POE2 오버레이.

[Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2)
(Awakened PoE Trade 의 POE2 포크, MIT)를 기반으로 한 포크이며,
**시장 곡선 판정** 기능을 얹었습니다:

- 활 가격 체크 시 "이 DPS 시장 최저가 / 한 계단 위 가격"을 즉시 판정
- 데이터는 [활 시세 감정소](https://skekdi4561.github.io/poe2-bow/)의
  24시간 합집합 스냅샷 (즉시 구매 가능 매물만 집계)
- 원본의 전 아이템 가격 체크·오버레이·카카오 렐름/한국어 지원은 그대로

## 투명성 고지

- 이 포크는 **AI(Claude) 페어 프로그래밍으로 개발**됩니다. 원본 프로젝트의
  기여 정책(AI 코드 금지)을 존중해 업스트림에 PR 을 보내지 않습니다.
- 원본 저작권 및 MIT 라이선스는 LICENSE 에 그대로 유지됩니다.
- 게임 클라이언트·메모리·파일에 접촉하지 않습니다 (원본과 동일한 원칙).

## 빌드

```
cd renderer && npm install && npm run make-index-files && npm run build
cd ../main  && npm install && npm run build && npm run package
```
