#!/bin/bash

# 전체 서버 실행 스크립트
# 크롤링 → 모델링 → 결과 저장까지 전체 프로세스 실행

# MongoDB 연결 정보 (환경변수 또는 .env 파일에서 읽기)
# .env 파일이 없으면 기본값 사용 (개발 환경에서만)
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# 환경변수가 없으면 경고 메시지
if [ -z "$MONGODB_URI" ] && [ -z "$MONGODB_URL" ]; then
    echo "⚠️  MONGODB_URI 또는 MONGODB_URL 환경변수가 설정되지 않았습니다."
    echo "   .env 파일을 생성하거나 환경변수를 설정해주세요."
    exit 1
fi

# 색상 정의
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}🚀 404DNF 통합 서버 시작${NC}"
echo -e "${BLUE}========================================${NC}\n"

# 기존 프로세스 종료
echo -e "${YELLOW}🔍 기존 프로세스 확인 중...${NC}"
# Extension 서버 프로세스 종료
pkill -f "nodemon.*server.js" 2>/dev/null && echo -e "${GREEN}✅ Extension 서버 프로세스 정리 완료${NC}" || echo -e "${YELLOW}⚠️  Extension 서버 프로세스 없음${NC}"
# Web 서버 프로세스 종료
pkill -f "nodemon.*server.js" 2>/dev/null | grep -v "404DNF_ChomeExtensions" && echo -e "${GREEN}✅ Web 서버 프로세스 정리 완료${NC}" || true
# Model 서버 프로세스 종료
pkill -f "python.*app.py" 2>/dev/null && echo -e "${GREEN}✅ Model 서버 프로세스 정리 완료${NC}" || echo -e "${YELLOW}⚠️  Model 서버 프로세스 없음${NC}"
# 포트로도 확인
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 3000 정리 완료${NC}" || true
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 8000 정리 완료${NC}" || true
lsof -ti:5005 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 5005 정리 완료${NC}" || true
sleep 2

# 루트 디렉토리로 이동
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# Web 서버 시작 (nodemon)
echo -e "\n${BLUE}[1/3] Web 서버 시작 중...${NC}"
cd "$ROOT_DIR/404DNF_web/server"
# nodemon이 없으면 npx로 실행
if command -v nodemon &> /dev/null; then
    nodemon server.js > /tmp/web_server.log 2>&1 &
else
    npx nodemon server.js > /tmp/web_server.log 2>&1 &
fi
WEB_PID=$!
echo -e "${GREEN}✅ Web 서버 시작됨 (PID: $WEB_PID)${NC}"
echo -e "${YELLOW}   로그: tail -f /tmp/web_server.log${NC}"

# Extension 서버 시작 (nodemon)
echo -e "\n${BLUE}[2/3] Extension 서버 시작 중...${NC}"
cd "$ROOT_DIR/404DNF_ChomeExtensions/server"
# nodemon이 없으면 npx로 실행
if command -v nodemon &> /dev/null; then
    PORT=8000 nodemon server.js > /tmp/extension_server.log 2>&1 &
else
    PORT=8000 npx nodemon server.js > /tmp/extension_server.log 2>&1 &
fi
EXTENSION_PID=$!
echo -e "${GREEN}✅ Extension 서버 시작됨 (PID: $EXTENSION_PID, 포트: 8000)${NC}"
echo -e "${YELLOW}   로그: tail -f /tmp/extension_server.log${NC}"

# Model 서버 시작 (run.sh)
echo -e "\n${BLUE}[3/3] Model 서버 시작 중...${NC}"
cd "$ROOT_DIR/404DNF_web/model_server"
PORT=5005 ./run.sh > /tmp/model_server.log 2>&1 &
MODEL_PID=$!
echo -e "${GREEN}✅ Model 서버 시작됨 (PID: $MODEL_PID, 포트: 5005)${NC}"
echo -e "${YELLOW}   로그: tail -f /tmp/model_server.log${NC}"

# 서버 시작 대기
echo -e "\n${YELLOW}⏳ 서버 시작 대기 중 (10초)...${NC}"
sleep 10

# 서버 상태 확인
echo -e "\n${BLUE}📊 서버 상태 확인${NC}"
echo -e "----------------------------------------"
if curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Web 서버 (포트 3000): 정상${NC}"
else
    echo -e "${YELLOW}⚠️  Web 서버 (포트 3000): 응답 확인 중...${NC}"
fi

if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Extension 서버 (포트 8000): 정상${NC}"
else
    echo -e "${YELLOW}⚠️  Extension 서버 (포트 8000): 응답 확인 중...${NC}"
fi

if curl -s http://localhost:5005/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Model 서버 (포트 5005): 정상${NC}"
else
    echo -e "${YELLOW}⚠️  Model 서버 (포트 5005): 응답 확인 중...${NC}"
    sleep 2
    if curl -s http://localhost:5005/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Model 서버 (포트 5005): 정상${NC}"
    else
        echo -e "${YELLOW}⚠️  Model 서버 (포트 5005): 로그 확인 필요${NC}"
    fi
fi
echo -e "----------------------------------------"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ 모든 서버가 시작되었습니다!${NC}"
echo -e "${GREEN}========================================${NC}\n"

echo -e "${BLUE}📋 사용 방법:${NC}"
echo -e "1. 크롬 익스텐션을 로드하세요"
echo -e "2. 웹페이지에서 '추출 & 저장' 버튼을 클릭하세요"
echo -e "3. 크롤링 → 번역 → 모델링 → 저장 과정이 자동으로 진행됩니다\n"

echo -e "${BLUE}📊 로그 확인:${NC}"
echo -e "   ${YELLOW}./watch_logs_simple.sh${NC} - 3개 로그 동시 확인 (간단)"
echo -e "   ${YELLOW}./watch_logs_color.sh${NC} - 3개 로그 색상 구분 확인 (권장)"
echo -e "   ${YELLOW}./show_logs.sh${NC} - 최근 로그 한번에 보기"
echo -e "   ${YELLOW}./show_logs.sh 50${NC} - 최근 50줄 보기\n"
echo -e "   개별 로그:"
echo -e "   Web 서버: ${YELLOW}tail -f /tmp/web_server.log${NC}"
echo -e "   Extension 서버: ${YELLOW}tail -f /tmp/extension_server.log${NC}"
echo -e "   Model 서버: ${YELLOW}tail -f /tmp/model_server.log${NC}\n"

echo -e "${BLUE}🛑 서버 종료:${NC}"
echo -e "   ${YELLOW}kill $WEB_PID $EXTENSION_PID $MODEL_PID${NC}"
echo -e "   또는 ${YELLOW}./stop_all.sh${NC}\n"

# PID 저장
echo "$WEB_PID $EXTENSION_PID $MODEL_PID" > /tmp/404dnf_pids.txt

# 백그라운드 프로세스 대기
wait

