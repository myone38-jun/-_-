# 12월 가족여행 지도 (홋카이도 vs 대만)

`family-trip-december.html` 한 파일에 3D 여행지도와 3박4일 계획이 모두 들어 있습니다. 인터넷 연결 없이 열리며, 카카오톡으로 파일을 보내 휴대폰 브라우저에서 열 수 있습니다.

## 다시 만들기
- `build/process.py hk|tw`: Overture Maps(OSM 파생) 원본에서 지도 데이터를 압축하고 도로·철도망으로 경로를 계산해 `data_*.b64`, `meta_*.json`을 만듭니다.
- `build/plan_hk.js`, `build/plan_tw.js`: 일정·항공·숙소·맛집·예산·현지 표현 내용입니다.
- `build/app.js`, `build/template.html`: three.js 지도와 화면입니다.
- `python3 build/build.py`: 위 내용을 합쳐 HTML 한 파일로 만듭니다(three.js 0.160, fflate 0.8.2 내장).

지도 데이터 © OpenStreetMap contributors (ODbL), Overture Maps Foundation 배포본 2026-09-23 · 지형 AWS Terrain Tiles.
