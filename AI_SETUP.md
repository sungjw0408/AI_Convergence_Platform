# RENTO AI 채팅 실행 안내

## 1. 실행 환경
- Python 3
- Gemini API 키
- Windows PowerShell 기준

## 2. API 키 설정

별도로 전달받은 시연용 .env 파일을
프로젝트 최상위 폴더에 저장합니다.

직접 설정하는 경우 .env.example 파일을
.env로 복사한 뒤 API 키를 입력합니다.

GEMINI_API_KEY=발급받은_API_키
GEMINI_MODEL=gemini-3.5-flash-lite

.env 파일은 GitHub에 업로드하지 않습니다.

## 3. 서버 실행

프로젝트 최상위 폴더에서 실행합니다.

py backend/chat_server.py --port 8001

## 4. 접속

http://localhost:8001

대여자 계정으로 전환한 뒤 AI 채팅을 실행합니다.

별도의 PowerShell 환경 변수 설정은 필요하지 않습니다.
서버 실행 시 .env 파일을 자동으로 불러옵니다.

## 5. 오류 발생 시

- .env 파일의 위치와 파일명 확인
- Gemini API 키 유효성 확인
- API 사용량 제한 확인
- 추천 가능한 물품이 있는지 확인
- 서버 재시작

## 6. 보안

시연용 API 키는 팀원에게만 별도로 전달합니다.
시연 종료 후 Google AI Studio에서 키를 폐기합니다.
