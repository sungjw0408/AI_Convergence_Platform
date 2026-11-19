# 브랜치·PR 협업 규칙

## 이웃창고 UI 실행

대여 전후 사진 비교까지 시연하려면 Python 3.12에서 저장소 루트를 기준으로 아래 명령을 실행합니다.

```bash
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements-compare.txt
backend/.venv/bin/python backend/compare_server.py --port 8092
```

Windows에서는 가상환경을 `py -3.12 -m venv backend/.venv`로 만들고 Python 실행 경로를 `backend/.venv/Scripts/python.exe`로 바꿉니다. 첫 기동 때 PyTorch 공식 서버에서 SqueezeNet 가중치 약 5MB를 받아 캐시합니다. [사진 비교 시연](http://localhost:8092/index.html#compare)에서 빔프로젝터 예시 또는 직접 촬영한 사진 두 장을 선택하세요. [모델 설명과 발표 문구](backend/README.md)

기존 프런트엔드만 보려면 `python3 -m http.server 8000 --directory frontend`로 실행할 수 있습니다. 사진 비교 API는 위의 Python 앱에서 제공합니다.

- `frontend/`에는 홈, 물품 등록·상세, 대여 거래, 채팅, 구독 안내 화면과 샘플 데이터가 있습니다.
- `backend/`는 전후 사진 비교 API와 시연용 웹 서버를 제공합니다.
- **마이 → 데모 프로필 전환**에서 대여자, 공급자, 관리자를 전환할 수 있습니다. 신청과 사진 등 시연 데이터는 같은 브라우저에 저장됩니다.
- 파손 시나리오는 미니 빔프로젝터를 주말에 신청한 뒤 인도 화면에서 손상 신고 예시를 고르면 시연할 수 있습니다.

## 브랜치

- 팀에서 미리 만드는 공용 개발 브랜치는 `develop` 하나입니다.
- 각 팀원은 작업을 시작할 때 최신 `develop`에서 자신의 작업 브랜치를 만듭니다. `develop`에 직접 푸시하지 않고 PR로 변경을 반영합니다.
- 브랜치는 작업 하나당 하나씩 만듭니다. 이름은 `유형/이슈번호-짧은-설명` 형식으로 작성합니다.

| 유형 | 용도 | 예시 |
| --- | --- | --- |
| `feat` | 기능 추가 | `feat/12-rental-request` |
| `fix` | 버그 수정 | `fix/24-booking-conflict` |
| `docs` | 문서 변경 | `docs/8-update-readme` |
| `refactor` | 동작을 유지하면서 코드 구조 개선 | `refactor/30-rental-service` |

```bash
git fetch origin
git switch develop
git pull --ff-only
git switch -c feat/12-rental-request
```

## Pull Request

1. 작업 브랜치에서 `develop`으로 PR을 엽니다. 제목에 변경 내용을 적습니다. 예를 들어 `대여 신청 기능 추가`처럼 작성합니다.
2. 본문에 변경 내용과 테스트 방법·결과를 적습니다. 관련 이슈가 있으면 `#12`처럼 연결합니다. 화면을 변경했다면 스크린샷을 첨부합니다.
3. **작성자 외 팀원 1명 이상이 승인**하고, 변경 요청을 모두 해결한 뒤 병합합니다. 충돌이 있으면 작업 브랜치에서 해결하고 다시 확인합니다. 자동 검사가 설정되어 있으면 통과 여부도 확인합니다.
4. 병합이 끝나면 작업 브랜치를 삭제합니다.

### PR 본문 양식

```markdown
## 변경 내용
-

## 관련 이슈
- #이슈번호

## 테스트 방법 및 결과
-
```
