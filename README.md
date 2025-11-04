# 404DNF 통합 프로젝트

다크패턴 탐지 서비스를 위한 통합 프로젝트입니다. 웹 애플리케이션과 크롬 익스텐션으로 구성되어 있습니다.

## 📁 프로젝트 구조

```
.
├── 404DNF_web/                 # 웹 애플리케이션
│   ├── client/                 # React + Vite 프론트엔드
│   ├── server/                 # Express 백엔드 서버
│   └── model_server/           # Flask 모델 서버 (다크패턴 분류)
├── 404DNF_ChomeExtensions/      # 크롬 익스텐션
│   ├── chrome_crawl_extension/ # 익스텐션 소스 코드
│   └── server/                 # 익스텐션용 API 서버
├── .gitignore
├── package.json
└── README.md
```

## 🔧 기술 스택

### Web App
- **Frontend**: React 19, Vite, TailwindCSS, React Router
- **Backend**: Node.js, Express, MongoDB (Mongoose)
- **ML Server**: Flask, PyTorch
- **Database**: MongoDB

### Chrome Extension
- **Extension**: Vanilla JS, Chrome Extension API
- **Server**: Node.js, Express, MongoDB (Mongoose)

## 🚀 시작하기

### 사전 요구사항
- Node.js (v18 이상)
- MongoDB (또는 MongoDB Atlas)
- Python 3.8+ (모델 서버용)
- Docker & Docker Compose (모델 서버용)

### 환경 변수 설정

각 서버 디렉토리에 `.env` 파일을 생성하세요:

#### `404DNF_web/server/.env`
```env
MONGODB_URL=your_mongodb_connection_string
DB_NAME=web
PORT=3000
# 기타 필요한 환경 변수
```

#### `404DNF_ChomeExtensions/server/.env`
```env
MONGODB_URI=your_mongodb_connection_string
PORT=8000  # 기본 포트: 8000 (환경변수로 변경 가능)
API_KEY=your_api_key  # 선택사항
ALLOWED_ORIGINS=http://localhost:3000,https://yourdomain.com
```

#### `404DNF_web/model_server/.env`
```env
MONGODB_URL=your_mongodb_connection_string
PORT=5005  # 기본 포트: 5005 (환경변수로 변경 가능)
```

### 🚀 빠른 시작 (전체 프로세스 실행)

**모든 서버를 한 번에 실행 (권장):**
```bash
./start_all.sh
```

이 스크립트는 다음을 수행합니다:
1. Extension 서버 (포트 8000) 시작
2. Model 서버 (포트 5005) 시작
3. MongoDB 연결 확인
4. 서버 상태 확인

**서버 종료:**
```bash
./stop_all.sh
```

### 설치 및 실행

#### 1. 모든 의존성 설치
```bash
npm run install:all
```

#### 2. 모델 파일 다운로드
모델 서버용 PyTorch 모델 파일(`dual_classifier_model.pth`)을 다운로드하여 `404DNF_web/model_server/model/` 디렉토리에 배치하세요.

[모델 파일 다운로드 링크](https://drive.google.com/file/d/1_m9N-IpxXITg5KNO9VLFrELi8dTn9qel/view?usp=sharing)

#### 3. 서버 실행

**웹 애플리케이션 서버:**
```bash
npm run web:server
```

**웹 애플리케이션 클라이언트:**
```bash
npm run web:client
```

**크롬 익스텐션 서버:**
```bash
npm run extension:server
```

**모델 서버:**
```bash
cd 404DNF_web/model_server
./run.sh
# 또는
python app.py
```

**모델 서버 (Docker - 선택사항):**
```bash
cd 404DNF_web/model_server
docker-compose up --build
```

## 🔌 포트 설정

각 서버의 기본 포트는 다음과 같습니다:

- **Extension 서버**: `8000` (포트 충돌 시 환경변수 `PORT`로 변경 가능)
- **Model 서버**: `5005` (포트 충돌 시 환경변수 `PORT`로 변경 가능)
- **Web 서버**: `3000` (기본값)

포트 충돌이 발생하면:
1. 기존 프로세스 종료: `lsof -ti:포트번호 | xargs kill -9`
2. 환경변수로 다른 포트 사용: `PORT=8001 node server.js`
3. `.env` 파일에 포트 설정 추가

### 크롬 익스텐션 설치

1. Chrome 브라우저에서 `chrome://extensions/` 접속
2. "개발자 모드" 활성화
3. "압축해제된 확장 프로그램을 로드합니다" 클릭
4. `404DNF_ChomeExtensions/chrome_crawl_extension/` 디렉토리 선택

## 📦 주요 기능

### 웹 애플리케이션
- 다크패턴 이미지 분석
- 다중분류 모델을 통한 다크패턴 탐지
- 법률 사례 및 뉴스 조회
- 퀴즈 및 학습 콘텐츠

### 크롬 익스텐션
- 웹사이트 크롤링
- 수집된 데이터를 MongoDB에 저장
- 실시간 다크패턴 분석

## 🔗 MongoDB 연결

두 프로젝트 모두 동일한 MongoDB 데이터베이스(`web`)를 사용하지만, 서로 다른 컬렉션을 사용합니다:
- **Web App**: `Users`, `case`, `law`, `news`, `predicate` 등
- **Chrome Extension**: `extension`

## 📝 개발 스크립트

```bash
# 모든 의존성 설치
npm run install:all

# 웹 서버 실행
npm run web:server

# 웹 클라이언트 실행 (개발 모드)
npm run web:client

# 익스텐션 서버 실행
npm run extension:server

# 익스텐션 서버 실행 (개발 모드, nodemon)
npm run extension:dev

# 모델 서버 실행 (Docker)
npm run model:server
```

## 🤝 기여하기

1. 이 저장소를 포크하세요
2. 기능 브랜치를 생성하세요 (`git checkout -b feature/AmazingFeature`)
3. 변경사항을 커밋하세요 (`git commit -m 'Add some AmazingFeature'`)
4. 브랜치에 푸시하세요 (`git push origin feature/AmazingFeature`)
5. Pull Request를 열어주세요

## 📄 라이선스

ISC

## 👥 팀

- 프로젝트 관련 문의는 저장소 이슈를 통해 남겨주세요.

