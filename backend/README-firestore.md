# 렌토 팀 시연용 Firestore

렌토의 Flask 서버가 공식 Python 클라이언트로 Cloud Firestore에 접근합니다. 앱에서 물품을 게시하고 예약을 신청하면 동일한 DB에 연결된 다른 브라우저에서도 새로고침 후 조회할 수 있습니다. DB 설정 없이 실행하면 기존 브라우저 시연 데이터를 계속 사용할 수 있습니다. 기존 거래나 사진을 자동 업로드하지 않습니다.

## 내 컴퓨터에서 실행

저장소 루트에서 시작합니다. Python 3.12, Node.js 22 및 Java 21 이상을 사용하세요. 아래 명령은 macOS용입니다.

1. Python 환경을 준비합니다. 이미 가상환경이 있으면 첫 줄을 건너뜁니다.

   ```sh
   python3.12 -m venv backend/.venv
   backend/.venv/bin/python -m pip install -r backend/requirements-compare.txt -r backend/requirements-db.txt
   ```

2. 첫 터미널에서 에뮬레이터를 실행합니다. 정상 종료할 때 데이터를 내보내며 다음 실행 때 다시 읽습니다.

   ```sh
   mkdir -p firebase-data
   npx --yes firebase-tools@14.27.0 emulators:start --only firestore --project demo-rento --import=./firebase-data --export-on-exit=./firebase-data
   ```

3. 둘째 터미널에서 앱 서버를 실행합니다.

   ```sh
   export RENTO_FIREBASE_PROJECT=demo-rento
   export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
   backend/.venv/bin/python backend/compare_server.py --port 8093
   ```

   Windows PowerShell에서는 Python 경로를 `backend/.venv/Scripts/python.exe`로 바꾸고 환경 변수는 `$env:RENTO_FIREBASE_PROJECT="demo-rento"`, `$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"`로 설정합니다.

4. [렌토](http://127.0.0.1:8093/)에서 물품을 등록한 후 [Firestore 데이터 화면](http://127.0.0.1:4000/firestore)에서 `rentoSpaces → team → listings`를 확인합니다. 다른 브라우저에서 같은 앱 주소를 열면 동일한 물품을 볼 수 있습니다. 대여를 시험하려면 내 정보에서 공급자로 물품을 게시하고, 대여자 프로필에서 신청한 후 공급자로 승인합니다.

## 문서 구조

아래 컬렉션은 `rentoSpaces/team` 아래에 있습니다. ID는 등록 시 한 번 생성합니다.

| 컬렉션 | 문서 1건 | 주요 필드 |
| --- | --- | --- |
| listings | 사용자가 게시한 물품 | title, owner, category, price, deposit, image, photos, coverPhotoId |
| rentals | 대여 신청부터 반납까지의 거래 | itemId, renterId, lenderId, start, end, total, status, inspection |
| messages | 거래 채팅 메시지 한 건 | rentalId, sender, text, sentAt |
| notices | 거래 알림 한 건 | rentalId, role, message, read |

기본 예시 물품 3개는 앱에 포함돼 있습니다. 사진 검사 기록과 AI 분석 결과의 중첩 배열은 거래 문서에 JSON 문자열로 저장한 뒤 조회할 때 복원합니다. 촬영 원본은 원래 브라우저의 IndexedDB에 있고 DB에는 참조가 들어갑니다. 따라서 다른 기기에서 거래·분석 기록은 보여도 원본 사진을 열려면 별도 파일 저장소 연동이 필요합니다. 역할 선택, 동네, 관심 목록은 브라우저별 설정입니다.

앱은 변경된 문서와 버전 번호를 한 트랜잭션으로 저장합니다. 다른 창이 먼저 저장한 경우 새로고침 안내가 나타나며 이전 버전으로 덮어쓰지 않습니다. 읽을 때는 한 시점의 팀 시연 데이터를 가져옵니다.

## 팀 전용 클라우드 프로젝트에 연결

이 절차는 각 팀원이 자기 컴퓨터에서 서버를 실행하는 경우입니다. 공용 서버 한 대로 연결하려면 [Cloud Run 배포 안내](README-cloud-run.md)를 따르세요.

프로젝트 ID는 `rento-14a30`이고 기본 데이터베이스 `(default)`는 서울(`asia-northeast3`)에 있습니다. 팀의 Firestore 규칙은 배포되어 있습니다. [팀 DB 데이터 화면](https://console.firebase.google.com/project/rento-14a30/firestore/databases/-default-/data)

1. 프로젝트 소유자가 각 팀원의 Google 계정에 **Cloud Datastore User**(`roles/datastore.user`)와 **Service Usage Consumer**(`roles/serviceusage.serviceUsageConsumer`) 권한을 부여합니다. 개발 계정은 Firestore 데이터 읽기·쓰기와 팀 프로젝트의 API 할당량 사용에 이 권한을 사용합니다. [팀 프로젝트 IAM](https://console.cloud.google.com/iam-admin/iam?project=rento-14a30)
2. 각 팀원은 DB 변경 사항이 적용된 코드와 Python 3.12, Google Cloud CLI를 준비합니다. 아래 명령은 저장소 루트에서 실행합니다. `gcloud` 로그인 창에서는 권한을 부여받은 본인 계정으로 **Google Cloud 데이터 보기 및 관리** 권한을 승인합니다. 로그인과 의존성 설치는 처음 연결할 때 한 번 실행합니다. [Google Cloud CLI 설치](https://docs.cloud.google.com/sdk/docs/install-sdk)

   **macOS**

   ```sh
   python3.12 -m venv backend/.venv
   backend/.venv/bin/python -m pip install -r backend/requirements-compare.txt -r backend/requirements-db.txt
   gcloud auth application-default login --project=rento-14a30 --scopes=https://www.googleapis.com/auth/cloud-platform
   unset FIRESTORE_EMULATOR_HOST
   export RENTO_FIREBASE_PROJECT=rento-14a30
   backend/.venv/bin/python backend/compare_server.py --port 8095
   ```

   **Windows PowerShell**

   ```powershell
   py -3.12 -m venv backend/.venv
   backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-compare.txt -r backend/requirements-db.txt
   gcloud auth application-default login --project=rento-14a30 --scopes=https://www.googleapis.com/auth/cloud-platform
   Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
   $env:RENTO_FIREBASE_PROJECT = "rento-14a30"
   backend/.venv/Scripts/python.exe backend/compare_server.py --port 8095
   ```

3. 각자 [렌토 팀 DB 버전](http://127.0.0.1:8095/)을 엽니다. 한 사람이 물품을 게시하고 다른 사람이 앱을 새로고침하면 같은 물품을 볼 수 있습니다. DB 콘솔의 `rentoSpaces/team/listings`에서도 확인할 수 있습니다. 로컬 에뮬레이터는 별도 데이터를 사용합니다.

이 버전은 로컬에서 대여자·공급자·관리자를 전환하는 팀 시연용입니다. 로컬 실행에서는 DB API가 루프백에서만 열립니다. 외부 사용자에게 배포하려면 실제 로그인 계정과 거래 참여자 권한을 서버에서 확인하도록 바꿔야 합니다. 서버는 Google 기본 인증 정보(ADC)와 IAM으로 접근하며 웹 클라이언트 직접 접근은 규칙으로 차단합니다. [Firestore 접근 제어](https://firebase.google.com/docs/firestore/security/get-started) · [Google 로컬 인증 설정](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)

에뮬레이터가 실행된 상태에서 `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 backend/.venv/bin/python -m unittest discover -s backend -p 'test_rental_database.py' -v`로 저장·재조회·충돌 처리를 검사할 수 있습니다. 테스트는 임시 공간을 사용합니다.
