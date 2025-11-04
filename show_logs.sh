#!/bin/bash

# 3개 서버의 최근 로그를 한번에 보는 스크립트

# 색상 정의
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# 로그 파일 경로
WEB_LOG="/tmp/web_server.log"
EXTENSION_LOG="/tmp/extension_server.log"
MODEL_LOG="/tmp/model_server.log"

# 라인 수 (기본값: 20)
LINES=${1:-20}

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}📊 서버 로그 최근 ${LINES}줄${NC}"
echo -e "${BLUE}========================================${NC}\n"

# Web 서버 로그
if [ -f "$WEB_LOG" ]; then
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🟦 Web 서버 (최근 ${LINES}줄)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    tail -n "$LINES" "$WEB_LOG" | sed "s/^/${CYAN}[Web]${NC} /"
    echo ""
else
    echo -e "${RED}❌ Web 서버 로그 파일이 없습니다: $WEB_LOG${NC}\n"
fi

# Extension 서버 로그
if [ -f "$EXTENSION_LOG" ]; then
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}🟪 Extension 서버 (최근 ${LINES}줄)${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    tail -n "$LINES" "$EXTENSION_LOG" | sed "s/^/${MAGENTA}[Extension]${NC} /"
    echo ""
else
    echo -e "${RED}❌ Extension 서버 로그 파일이 없습니다: $EXTENSION_LOG${NC}\n"
fi

# Model 서버 로그
if [ -f "$MODEL_LOG" ]; then
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}🟨 Model 서버 (최근 ${LINES}줄)${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    tail -n "$LINES" "$MODEL_LOG" | sed "s/^/${YELLOW}[Model]${NC} /"
    echo ""
else
    echo -e "${RED}❌ Model 서버 로그 파일이 없습니다: $MODEL_LOG${NC}\n"
fi

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ 로그 표시 완료${NC}"
echo -e "${BLUE}========================================${NC}\n"
echo -e "${YELLOW}💡 실시간 로그 보기: ./watch_logs_color.sh${NC}"
echo -e "${YELLOW}💡 더 많은 라인 보기: ./show_logs.sh 50${NC}\n"

