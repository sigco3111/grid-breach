# SF 핵앤슬래시 (SF Hack-and-Slash prototype)

Three.js + Vite 기반의 3인칭 SF 슈터 프로토타입입니다. 달빛 아래 야드에서 드론과 메카를 소총으로 처치하는 것이 지금의 전부이고, 계속 다듬는 중입니다.

## 조작 (PC)
- WASD 이동, Shift 달리기(달리는 동안은 조준·사격 불가), Space 점프
- 마우스 클릭으로 시점 잡기, 우클릭 유지로 조준, 좌클릭 유지로 사격
- H 어깨 전환, 1 무기, Tab 캐릭터 화면, G 스테이지 에디터(기본 숨김), P 일시정지, F 상태 표시
- 터치 기기는 화면 컨트롤을 사용합니다.

## 개발
```
npm install
npm run dev     # http://127.0.0.1:5173
npm run build   # dist/
```

## 출처와 라이선스
- 코드는 MIT 템플릿(SoldierThirdPersonThreeJS, achrefelouafi)에서 출발해 수정했습니다. LICENSE 참고.
- 모든 3D·텍스처·폰트 에셋의 출처와 라이선스는 [ASSET-SOURCES.md](ASSET-SOURCES.md)에 있습니다.
