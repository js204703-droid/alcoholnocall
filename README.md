# 알콜노콜 (ACNC) v2.0

술김에 연락하지 않도록 도와주는 앱

## 기능
- 🔒 연락처 임시 숨기기 / 자동 복구
- ⏰ 보호 예약 (술 마시기 전에 미리)
- 🔐 PIN 잠금 (보호 중 해제 방지)
- 📊 보호 기록 통계
- 🔔 복구 알림

## Expo Snack에서 미리보기

1. https://snack.expo.dev 접속
2. App.js 내용 붙여넣기
3. 오른쪽 QR코드로 Expo Go 앱에서 바로 테스트

## EAS Build로 .apk 만들기

```bash
# 1. expo.dev 에서 계정 생성
# 2. 프로젝트 생성 후 projectId를 app.json에 입력

# 3. EAS Build 실행 (eas.build.dev 웹사이트에서도 가능)
eas build --platform android --profile preview
```

## 필요한 패키지
- expo ~50.0.0
- expo-contacts ~12.6.0
- expo-notifications ~0.27.0
- @react-native-async-storage/async-storage 1.21.0

## 플레이스토어 등록 시
- .aab 형식으로 빌드: `eas build --platform android --profile production`
- targetSdkVersion 34 이상 필수
- 연락처 권한 사용 이유 명시 필요
