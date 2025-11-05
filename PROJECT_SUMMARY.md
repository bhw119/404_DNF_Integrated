# 404DNF 프로젝트 전체 요약

## 📋 프로젝트 개요

**404DNF**는 웹사이트의 다크패턴을 자동으로 탐지하고 분석하는 통합 시스템입니다. Chrome Extension, 3개의 서버, 그리고 AI 모델이 협력하여 실시간으로 웹사이트의 다크패턴을 분석합니다.

---

## 🏗️ 전체 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│  (크롤링, 번역, 전처리, UI)                                  │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP POST /collect
                         │ (fullText, originalText, frames)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         Extension Server (포트 8000)                        │
│  - 크롤링 데이터 수신 및 MongoDB 저장                        │
│  - extension 컬렉션에 문서 저장                              │
│  - 문서 조회 API 제공                                        │
└────────────────────────┬────────────────────────────────────┘
                         │ MongoDB Change Stream
                         │ (실시간 변경 감지)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         Model Server (포트 5005)                            │
│  - Flask 기반 AI 모델 서버                                   │
│  - ResGCN 모델로 다크패턴 예측                               │
│  - model 컬렉션에 결과 저장                                  │
└─────────────────────────────────────────────────────────────┘
                         │
                         │ MongoDB (web 데이터베이스)
                         │ - extension 컬렉션
                         │ - model 컬렉션
                         │
┌─────────────────────────────────────────────────────────────┐
│         Web Server (포트 3000)                              │
│  - React 클라이언트용 API 서버                               │
│  - 사용자 인증, 뉴스, 퀴즈, 법률 정보 등 제공                │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 주요 구성 요소

### 1. Chrome Extension
**위치**: `404DNF_ChomeExtensions/chrome_crawl_extension/`

**주요 기능**:
- 웹페이지 크롤링 (텍스트, 프레임 추출)
- 한글 텍스트를 영어로 자동 번역 (Google Translate API)
- 다크패턴 전처리 (4자 이상, 특수문자/숫자 비율 필터링)
- Extension Server로 데이터 전송
- Side Panel로 분석 결과 표시

**주요 파일**:
- `popup.js`: 크롤링 및 데이터 전송 로직
- `sidepanel_analysis.js`: 상세 분석 결과 표시
- `sidepanel_summary.js`: 요약 통계 표시
- `content.js`: 웹페이지 콘텐츠 추출

**데이터 흐름**:
```
사용자 클릭 → 텍스트 추출 → 전처리 → 번역 → Extension Server 전송
```

---

### 2. Extension Server (포트 8000)
**위치**: `404DNF_ChomeExtensions/server/`

**기술 스택**: Node.js, Express, MongoDB (Mongoose)

**주요 기능**:
- 크롤링 데이터 수신 (`POST /collect`)
- MongoDB `extension` 컬렉션에 저장
- 문서 조회 API (`GET /doc/:id`, `GET /latest`)
- 모델 결과 조회 API (`GET /model`, `GET /model/summary`)
- 모델링 진행 상황 추적 (`GET /model/progress/:id`)

**MongoDB 컬렉션**:
- `extension`: 크롤링된 원본 데이터
  - `fullText`: 번역된 영어 텍스트 (모델링용, `*`로 구분)
  - `originalText`: 원본 한글 텍스트 (표시용, `*`로 구분)
  - `modelingStatus`: `pending`, `processing`, `completed`, `failed`
  - `modelingProgress`: `{current: 0, total: 0}`

**API 엔드포인트**:
```
POST /collect          - 크롤링 데이터 저장
GET  /doc/:id          - 특정 문서 조회
GET  /latest?tabUrl=... - 최신 문서 조회
GET  /model?id=...     - 모델 결과 조회
GET  /model/summary    - 모델 요약 통계
GET  /health           - 서버 상태 확인
```

---

### 3. Model Server (포트 5005)
**위치**: `404DNF_web/model_server/`

**기술 스택**: Python, Flask, PyTorch, MongoDB (PyMongo)

**주요 기능**:
- MongoDB Change Stream으로 `extension` 컬렉션 실시간 감시
- 새로운 문서 감지 시 자동으로 모델링 실행
- ResGCN 모델로 다크패턴 예측
- `model` 컬렉션에 결과 저장

**AI 모델**:
- **모델 파일**: `resgcn_improved.pt`
- **아키텍처**: ResGCN (Residual Graph Convolutional Network)
- **입력**: Sentence Transformer 임베딩 (영어 텍스트)
- **출력**: 
  - `is_darkpattern`: 다크패턴 여부 (Boolean)
  - `predicate`: 다크패턴 유형 (Urgency, Scarcity, Social Proof, Misdirection 등)
  - `probability`: 다크패턴 확률 (0-100%)
  - `category`: 법률 카테고리 매핑

**처리 흐름**:
```
1. MongoDB Change Stream으로 새 문서 감지
2. fullText를 * 기준으로 문장 분리
3. 각 문장에 대해:
   - Sentence Transformer로 임베딩 생성
   - ResGCN 모델로 예측
   - originalText와 매핑하여 결과 저장
4. model 컬렉션에 결과 저장
5. extension 문서의 modelingStatus 업데이트
```

**MongoDB 컬렉션**:
- `model`: 모델 예측 결과
  - `id`: extension 문서의 `_id` (문자열)
  - `is_darkpattern`: 다크패턴 여부
  - `predicate`: 다크패턴 유형
  - `probability`: 확률
  - `category`: 법률 카테고리
  - `string`: 원본 한글 텍스트 (originalText에서 매핑)

**API 엔드포인트**:
```
POST /predict          - 이미지 분석 (웹 클라이언트용)
POST /predict/text     - 텍스트 분석 (직접 호출용)
GET  /health           - 서버 상태 확인
```

---

### 4. Web Server (포트 3000)
**위치**: `404DNF_web/server/`

**기술 스택**: Node.js, Express, MongoDB (Mongoose, MongoClient)

**주요 기능**:
- React 클라이언트용 REST API 제공
- 사용자 인증 및 회원 관리
- 다크패턴 뉴스, 법률 사례, 퀴즈 데이터 제공
- 이미지 업로드 및 분석 요청 (Model Server 호출)

**MongoDB 컬렉션**:
- `Users`: 사용자 정보
- `news`: 다크패턴 뉴스
- `law`: 법률 정보
- `case`: 법률 사례
- `quiz`: 퀴즈 문제
- `predicate`: 다크패턴 유형 정보

**주요 라우트**:
```
/api/auth/*            - 인증 관련
/api/news/*            - 뉴스 관련
/api/law/*             - 법률 관련
/api/quiz/*            - 퀴즈 관련
/api/predict/*         - 예측 요청 (Model Server 호출)
/api/upload/*          - 이미지 업로드
```

---

## 🔄 전체 데이터 흐름

### 1. 크롤링 및 저장 단계
```
[사용자] Chrome Extension에서 "추출 & 저장" 클릭
    ↓
[Extension] 웹페이지 텍스트 추출
    ↓
[Extension] 전처리 (4자 이상, 특수문자 필터링)
    ↓
[Extension] Google Translate API로 영어 번역
    ↓
[Extension] POST http://localhost:8000/collect
    {
      fullText: "번역된 텍스트*문장2*문장3...",
      originalText: "원본 한글*문장2*문장3...",
      tabUrl: "...",
      frames: [...]
    }
    ↓
[Extension Server] MongoDB extension 컬렉션에 저장
    ↓
[Extension Server] 응답: {ok: true, id: "문서ID"}
```

### 2. 모델링 단계 (자동)
```
[MongoDB Change Stream] extension 컬렉션에 새 문서 삽입 감지
    ↓
[Model Server] 새 문서 감지
    ↓
[Model Server] fullText를 * 기준으로 분리
    ↓
[Model Server] 각 문장에 대해:
    - Sentence Transformer로 임베딩 생성
    - ResGCN 모델로 예측
    - originalText와 매핑
    ↓
[Model Server] MongoDB model 컬렉션에 결과 저장
    ↓
[Model Server] extension 문서의 modelingStatus를 "completed"로 업데이트
```

### 3. 결과 조회 단계
```
[사용자] Chrome Extension Side Panel에서 "분석 보기" 클릭
    ↓
[Extension] GET http://localhost:8000/doc/:id
    ↓
[Extension Server] extension 컬렉션에서 문서 조회
    ↓
[Extension] GET http://localhost:8000/model?id=:id
    ↓
[Extension Server] model 컬렉션에서 결과 조회
    ↓
[Extension] originalText를 사용하여 결과 표시
    - 다크패턴 문장 하이라이트
    - 유형별 통계
    - 위험 지수 계산
```

---

## 🗄️ MongoDB 데이터베이스 구조

**데이터베이스**: `web`

### extension 컬렉션
```javascript
{
  _id: ObjectId("..."),
  tabUrl: "https://example.com",
  tabTitle: "페이지 제목",
  collectedAt: ISODate("..."),
  framesCollected: 5,
  fullText: "translated text*sentence 2*sentence 3...",  // 번역된 영어 (모델링용)
  originalText: "원본 한글*문장2*문장3...",              // 원본 한글 (표시용)
  frames: ["url1", "url2", ...],
  modelingStatus: "completed",  // pending, processing, completed, failed
  modelingProgress: {
    current: 100,
    total: 100
  },
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

### model 컬렉션
```javascript
{
  _id: ObjectId("..."),
  id: "extension문서의_id",  // 문자열로 저장
  is_darkpattern: true,
  predicate: "Urgency",
  probability: 85,
  category: "법률 카테고리",
  string: "원본 한글 문장",  // originalText에서 매핑
  createdAt: ISODate("..."),
  updatedAt: ISODate("...")
}
```

---

## 🚀 실행 방법

### 1. 전체 서버 한 번에 실행 (권장)
```bash
./start_all.sh
```

이 스크립트는 다음을 실행합니다:
1. Web Server (포트 3000)
2. Extension Server (포트 8000)
3. Model Server (포트 5005)

### 2. 개별 서버 실행
```bash
# Extension Server
cd 404DNF_ChomeExtensions/server
npm start

# Model Server
cd 404DNF_web/model_server
./run.sh

# Web Server
cd 404DNF_web/server
npm start
```

### 3. 로그 확인
```bash
# 전체 로그 동시 확인
./watch_logs_color.sh

# 개별 로그
tail -f /tmp/extension_server.log  # Extension Server
tail -f /tmp/model_server.log      # Model Server
tail -f /tmp/web_server.log         # Web Server
```

---

## 🔑 주요 기술 특징

### 1. 실시간 모델링
- MongoDB Change Stream을 사용하여 새 문서가 추가되면 자동으로 모델링 실행
- 진행 상황을 실시간으로 추적하여 UI에 표시

### 2. 원본 텍스트 보존
- `fullText`: 모델에 입력되는 번역된 영어 텍스트
- `originalText`: 사용자에게 표시되는 원본 한글 텍스트
- 모델 결과와 원본 텍스트를 정확히 매핑

### 3. 다크패턴 전처리
- 4자 이상의 텍스트만 유지
- 숫자 비율 80% 이상, 특수문자 비율 50% 이상 필터링
- 의미 없는 짧은 단어 제거

### 4. 확장 가능한 아키텍처
- 3개의 독립적인 서버로 역할 분리
- 각 서버는 독립적으로 배포 및 확장 가능
- MongoDB를 통한 느슨한 결합

---

## 📊 서버 간 통신 요약

| 서버 | 포트 | 역할 | 통신 대상 |
|------|------|------|-----------|
| **Extension Server** | 8000 | 크롤링 데이터 관리 | Chrome Extension ↔ MongoDB |
| **Model Server** | 5005 | AI 모델 실행 | MongoDB (Change Stream) |
| **Web Server** | 3000 | 웹 클라이언트 API | React Client ↔ MongoDB ↔ Model Server |

### 통신 흐름
1. **Extension → Extension Server**: HTTP POST (크롤링 데이터)
2. **Extension Server → MongoDB**: 저장 및 조회
3. **MongoDB → Model Server**: Change Stream (실시간 감지)
4. **Model Server → MongoDB**: 모델 결과 저장
5. **Extension → Extension Server**: HTTP GET (결과 조회)
6. **Web Client → Web Server**: HTTP API (웹 기능)
7. **Web Server → Model Server**: HTTP POST (이미지 분석)

---

## 🔐 환경 변수

### 공통 환경 변수
```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/web?retryWrites=true&w=majority
```

### Extension Server (.env)
```env
PORT=8000
MONGODB_URI=...
API_KEY=...  # 선택사항
ALLOWED_ORIGINS=http://localhost:3000
```

### Model Server (.env)
```env
PORT=5005
MONGODB_URL=...
# 또는 MONGODB_URI
```

### Web Server (.env)
```env
MONGODB_URI=...
DB_NAME=web
PORT=3000
```

---

## 📝 주요 파일 구조

```
404DNF_Integrated/
├── 404DNF_ChomeExtensions/
│   ├── chrome_crawl_extension/
│   │   ├── popup.js              # 크롤링 및 전송 로직
│   │   ├── sidepanel_analysis.js # 상세 분석 UI
│   │   ├── sidepanel_summary.js  # 요약 통계 UI
│   │   └── manifest.json
│   └── server/
│       └── server.js             # Extension Server
│
├── 404DNF_web/
│   ├── client/                   # React 클라이언트
│   ├── server/
│   │   └── server.js             # Web Server
│   └── model_server/
│       ├── app.py                # Model Server (Flask)
│       └── model/
│           ├── predictor.py      # 모델 예측 로직
│           ├── resgcn.py         # ResGCN 모델 정의
│           └── resgcn_improved.pt # 모델 파일
│
├── start_all.sh                  # 전체 서버 실행
├── stop_all.sh                   # 전체 서버 종료
└── watch_logs_color.sh           # 로그 확인
```

---

## 🎯 핵심 기능 요약

1. **자동 크롤링**: Chrome Extension으로 웹페이지 텍스트 자동 추출
2. **자동 번역**: 한글 텍스트를 영어로 자동 번역 (Google Translate API)
3. **실시간 모델링**: MongoDB Change Stream으로 자동 모델링 실행
4. **다크패턴 탐지**: ResGCN 모델로 다크패턴 유형 및 확률 예측
5. **시각화**: Side Panel에서 분석 결과를 직관적으로 표시
6. **통계 분석**: 위험 지수, 유형별 분포, TOP3 다크패턴 유형 제공

---

이 문서는 프로젝트의 전체 구조와 서버 간의 관계를 이해하는 데 도움이 됩니다.

