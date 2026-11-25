# 렌토 Cloud Run 팀 시연 서버

개인 계정 가입과 로그인을 사용하는 배포는 [개인 계정 배포 설정](README-accounts.md#cloud-run에-올릴-때)을 함께 적용하세요.

Cloud Run에서 앱 화면과 API를 함께 실행합니다. 서버는 전용 서비스 계정으로 서울의 팀 Firestore `rento-14a30`에 연결하고 기존 `rentoSpaces/team` 데이터를 사용합니다. 팀원은 HTTPS 주소를 열고 사용자 이름 `rento`와 팀 비밀번호로 들어갑니다. 참여자별 데이터 접근 권한을 사용하는 공개 서비스는 현재 데모 프로필 전환을 실제 사용자 인증으로 바꿔야 합니다.

## 비용

소스 배포에는 결제 계정이 연결된 Google Cloud 프로젝트가 필요합니다. 아래 설정은 요청 기반 과금, 최소 인스턴스 0개, 최대 1개입니다. Cloud Run 무료 한도는 매월 요청 200만 건, CPU 18만 vCPU초, 메모리 36만 GiB초입니다. 기존 Firestore의 무료 한도는 저장 1GiB, 읽기 하루 5만 건, 쓰기 하루 2만 건입니다. Cloud Build와 Artifact Registry 등은 각 서비스의 사용량으로 별도 계산됩니다. [Cloud Run 요금](https://cloud.google.com/run/pricing) · [Firestore 무료 한도](https://firebase.google.com/docs/firestore/quotas#free-quota) · [Artifact Registry 요금](https://cloud.google.com/artifact-registry/pricing)

## 처음 배포할 때

결제 계정 연결을 팀에서 결정한 후, 프로젝트 관리자가 저장소 루트에서 아래 macOS 또는 Cloud Shell 명령을 실행합니다. Google Cloud CLI로 프로젝트 관리 권한이 있는 계정에 로그인합니다.

```sh
gcloud auth login

RENTO_PROJECT=rento-14a30
RENTO_REGION=asia-northeast3
RENTO_RUN_IDENTITY="rento-run@${RENTO_PROJECT}.iam.gserviceaccount.com"
RENTO_BUILD_IDENTITY="rento-build@${RENTO_PROJECT}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project="$RENTO_PROJECT"

gcloud iam service-accounts create rento-run --project="$RENTO_PROJECT"
gcloud iam service-accounts create rento-build --project="$RENTO_PROJECT"

gcloud projects add-iam-policy-binding "$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_RUN_IDENTITY" --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_BUILD_IDENTITY" --role=roles/run.builder

openssl rand -hex 24 | tr -d '\n' | gcloud secrets create rento-team-password \
  --project="$RENTO_PROJECT" --replication-policy=automatic --data-file=-

gcloud secrets add-iam-policy-binding rento-team-password --project="$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_RUN_IDENTITY" --role=roles/secretmanager.secretAccessor
```

프로젝트 관리자는 Secret Manager에서 비밀번호 버전을 확인하고 팀원에게 개별 전달합니다. 서비스 계정은 Cloud Run이 연결한 환경 인증으로 Firestore에 접근합니다. [Cloud Run 서비스 ID](https://docs.cloud.google.com/run/docs/securing/service-identity) · [Cloud Run 비밀 연결](https://docs.cloud.google.com/run/docs/configuring/services/secrets)

## 앱 배포

Cloud Build가 저장소 루트의 Dockerfile로 웹 앱과 서버를 이미지 하나로 빌드합니다. Cloud Run은 팀 비밀번호 확인을 앱에 맡겨 팀원이 브라우저에서 접속할 수 있게 합니다.

```sh
gcloud run deploy rento --source=. --project="$RENTO_PROJECT" --region="$RENTO_REGION" \
  --service-account="$RENTO_RUN_IDENTITY" \
  --build-service-account="projects/$RENTO_PROJECT/serviceAccounts/$RENTO_BUILD_IDENTITY" \
  --set-env-vars="RENTO_FIREBASE_PROJECT=$RENTO_PROJECT" \
  --set-secrets="RENTO_TEAM_PASSWORD=rento-team-password:1" \
  --no-invoker-iam-check --cpu=1 --memory=2Gi --cpu-throttling --min=0 --max=1 \
  --concurrency=4 --timeout=120s
```

명령이 출력한 HTTPS 주소를 브라우저 두 개에서 열고 팀 비밀번호를 입력합니다. 한쪽에서 저장한 물품이 다른 쪽에서 새로고침 후 표시되는지 확인합니다. 이후 빌드에는 서비스 계정과 비밀 생성 단계를 건너뜁니다. 비밀번호를 교체할 때는 Secret Manager에 새 버전을 추가한 뒤 `--set-secrets`의 버전 번호를 갱신합니다.

사진 비교 모델은 CPU에서 실행하며 모델 가중치는 이미지 빌드 시 내려받습니다. 현재 별도 AI 도우미 채팅은 로컬 Ollama에 의존해 이 배포에서 사용할 수 없습니다. 거래 채팅은 Firestore에 저장됩니다.
