# 렌토 Cloud Run 팀 서버

Cloud Run에서 웹 화면과 API를 함께 실행합니다. 서버는 전용 서비스 계정으로 서울의 `rento-14a30` Firestore에 연결하고, 렌토 개인 계정과 `rentoSpaces/accounts` 데이터를 사용합니다. 팀원은 HTTPS 주소를 열어 사용자 이름 `rento`와 팀 접속 암호를 입력한 뒤, 앱에서 각자의 계정으로 가입하거나 로그인합니다.

## 비용

소스 배포에는 결제 계정이 연결된 Google Cloud 프로젝트가 필요합니다. 아래 설정은 요청 기반 과금, 최소 인스턴스 0개, 최대 1개입니다. Cloud Run 실행, Cloud Build 빌드, Artifact Registry 이미지 저장은 서비스별 무료 한도와 요금이 적용됩니다. Google Cloud 무료 체험으로 배포한 경우 체험 기간 또는 크레딧이 끝나면 서버가 중지됩니다. [Cloud Run 요금](https://cloud.google.com/run/pricing) · [Google Cloud 무료 체험](https://docs.cloud.google.com/free/docs/free-cloud-features#free-trial)

## 처음 배포할 때

결제 계정이 연결된 프로젝트의 관리자가 저장소 루트에서 아래 명령을 실행합니다. Firebase Authentication에서 이메일·비밀번호 로그인을 활성화합니다.

```sh
gcloud auth login

RENTO_PROJECT=rento-14a30
RENTO_REGION=asia-northeast3
RENTO_RUN_IDENTITY="rento-run@${RENTO_PROJECT}.iam.gserviceaccount.com"
RENTO_BUILD_IDENTITY="rento-build@${RENTO_PROJECT}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project="$RENTO_PROJECT"

gcloud iam service-accounts create rento-run --project="$RENTO_PROJECT"
gcloud iam service-accounts create rento-build --project="$RENTO_PROJECT"

gcloud iam roles create rentoAuthSessions --project="$RENTO_PROJECT" \
  --title="Rento Firebase login sessions" --stage=GA \
  --permissions=firebaseauth.users.get,firebaseauth.users.createSession
gcloud projects add-iam-policy-binding "$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_BUILD_IDENTITY" --role=roles/run.builder --condition=None
gcloud projects add-iam-policy-binding "$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_RUN_IDENTITY" --role=roles/datastore.user \
  --condition="expression=resource.name == 'projects/$RENTO_PROJECT/databases/(default)',title=RentoDefaultDatabase"
gcloud projects add-iam-policy-binding "$RENTO_PROJECT" \
  --member="serviceAccount:$RENTO_RUN_IDENTITY" \
  --role="projects/$RENTO_PROJECT/roles/rentoAuthSessions" --condition=None
```

Firebase 콘솔의 프로젝트 설정에서 웹 API 키를 확인한 뒤, 팀 접속 암호와 함께 Secret Manager에 저장합니다. 실행 계정에는 이 두 항목의 읽기 권한을 부여합니다.

```sh
openssl rand -hex 24 | tr -d '\n' | gcloud secrets create rento-team-password \
  --project="$RENTO_PROJECT" --replication-policy=automatic --data-file=-

printf 'Firebase 웹 API 키를 입력하세요: '
read -r -s RENTO_FIREBASE_WEB_API_KEY
printf '\n'
printf '%s' "$RENTO_FIREBASE_WEB_API_KEY" | gcloud secrets create rento-firebase-web-api-key \
  --project="$RENTO_PROJECT" --replication-policy=automatic --data-file=-
unset RENTO_FIREBASE_WEB_API_KEY

for secret in rento-team-password rento-firebase-web-api-key; do
  gcloud secrets add-iam-policy-binding "$secret" --project="$RENTO_PROJECT" \
    --member="serviceAccount:$RENTO_RUN_IDENTITY" --role=roles/secretmanager.secretAccessor --condition=None
done
```

## 앱 배포

Cloud Build가 저장소 루트의 Dockerfile로 웹 앱과 서버를 이미지 하나로 빌드합니다. 서버 시작 시 Firebase 인증 설정과 팀 접속 암호를 확인합니다.

```sh
gcloud run deploy rento --source=. --project="$RENTO_PROJECT" --region="$RENTO_REGION" \
  --service-account="$RENTO_RUN_IDENTITY" \
  --build-service-account="projects/$RENTO_PROJECT/serviceAccounts/$RENTO_BUILD_IDENTITY" \
  --set-env-vars="RENTO_FIREBASE_PROJECT=$RENTO_PROJECT" \
  --set-secrets="RENTO_TEAM_PASSWORD=rento-team-password:1,RENTO_FIREBASE_WEB_API_KEY=rento-firebase-web-api-key:1" \
  --no-invoker-iam-check --ingress=all --cpu=1 --memory=2Gi --cpu-throttling --min=0 --max=1 \
  --concurrency=4 --timeout=120s
```

프로젝트 관리자는 HTTPS 주소와 팀 접속 암호를 팀원에게 전달합니다. 새 브라우저에서 첫 팝업에 팀 접속 정보를 입력하고, 렌토 로그인 화면과 기존 계정의 물품 목록을 확인합니다. 재배포에는 기존 서비스 계정과 비밀을 사용합니다. 비밀을 교체하면 Secret Manager에 새 버전을 추가하고 `--set-secrets`의 버전 번호를 갱신합니다.

사진 비교 모델은 CPU에서 실행하며 가중치는 이미지 빌드 시 내려받습니다. 거래 채팅은 Firestore에 저장됩니다. Gemini 기능을 쓰려면 별도의 Gemini API 키를 연결해야 합니다.
