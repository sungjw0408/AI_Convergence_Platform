# 렌토 개인 계정

Firebase Authentication에서 이메일·비밀번호로 회원가입하고 로그인합니다. 브라우저는 서버가 발급한 HttpOnly 세션 쿠키를 사용하며, 배포 서버의 HTTPS에서는 Secure 속성도 사용합니다. Firestore는 대여·채팅·알림을 Firebase 사용자 ID로 분리합니다. 한 계정으로 다른 브라우저에 로그인하면 같은 대여·채팅·내 물품·관심 목록·동네 설정을 불러옵니다. 상대방의 새 채팅은 새로고침 후 확인할 수 있습니다.

데모 데이터는 `rentoSpaces/team`, 개인 계정 데이터는 `rentoSpaces/accounts`에 있습니다. 데모 기록에는 개인 ID가 없으므로 계정 가입과 연결하지 않습니다. 물품 등록 사진은 다른 계정에서도 볼 수 있도록 크기를 줄여 DB에 저장합니다. 대여·반납 사진 기록과 분석 결과는 DB에 저장하고, 카메라 촬영 원본은 찍은 브라우저의 IndexedDB에 보관합니다.

## 로컬에서 팀 Firebase 사용

팀 프로젝트 `rento-14a30`의 이메일·비밀번호 제공자는 활성화되어 있습니다. [Firebase Authentication 콘솔](https://console.firebase.google.com/project/rento-14a30/authentication/users)

1. Python 3.12 가상환경을 만든 뒤 `backend/requirements-compare.txt`와 `backend/requirements-db.txt`를 설치합니다. 서버 실행자는 Firestore 접근 및 Firebase 세션 생성·계정 조회 권한이 있는 Google Cloud 계정으로 ADC 로그인을 합니다.
2. Firebase 콘솔 프로젝트 설정의 **Default Web App**에서 API 키를 확인하고, 저장소 루트에 `.env.rento-auth` 파일을 만듭니다. 파일에 `RENTO_FIREBASE_WEB_API_KEY=키값`을 저장합니다.
3. 저장소 루트에서 서버를 실행합니다.

   ```sh
   set -a
   source .env.rento-auth
   set +a
   unset FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST
   RENTO_FIREBASE_PROJECT=rento-14a30 backend/.venv/bin/python backend/compare_server.py --port 8098
   ```

4. [렌토 개인 계정 화면](http://127.0.0.1:8098/)에서 **회원가입**을 선택합니다. 테스트할 때는 다른 브라우저에서 같은 계정으로 로그인하여 데이터가 유지되는지 확인합니다.

## 에뮬레이터로 개발

첫 터미널에서 `npx firebase-tools emulators:start --only auth,firestore --project demo-rento`를 실행합니다. 둘째 터미널에서 다음과 같이 앱을 실행합니다.

```sh
RENTO_FIREBASE_PROJECT=demo-rento FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 backend/.venv/bin/python backend/compare_server.py --port 8098
```

## Cloud Run에 올릴 때

[팀 서버 배포 안내](README-cloud-run.md)에 따라 팀 접속 암호와 Firebase 웹 API 키를 서버에 연결합니다. 팀원은 공용 주소에서 팀 접속 암호를 입력한 뒤 각자의 렌토 계정으로 가입하거나 로그인합니다.
