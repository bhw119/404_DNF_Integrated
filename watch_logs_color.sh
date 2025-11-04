#!/bin/bash

# 3개 서버의 로그를 색상으로 구분하여 실시간으로 보는 스크립트

# 색상 정의
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# 로그 파일 경로
WEB_LOG="/tmp/web_server.log"
EXTENSION_LOG="/tmp/extension_server.log"
MODEL_LOG="/tmp/model_server.log"

clear
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}📊 서버 로그 실시간 모니터링${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${GREEN}📋 모니터링 중인 서버:${NC}"
echo -e "   ${CYAN}🟦 Web 서버${NC}      (포트 3000) - $WEB_LOG"
echo -e "   ${MAGENTA}🟪 Extension 서버${NC} (포트 8000) - $EXTENSION_LOG"
echo -e "   ${YELLOW}🟨 Model 서버${NC}     (포트 5005) - $MODEL_LOG"
echo -e ""
echo -e "${YELLOW}💡 종료하려면 Ctrl+C를 누르세요${NC}\n"
echo -e "${BLUE}========================================${NC}\n"

# 로그 파일이 없으면 생성
touch "$WEB_LOG" "$EXTENSION_LOG" "$MODEL_LOG"

# 각 로그를 별도 프로세스로 tail하고 색상 태그 추가
(tail -f "$WEB_LOG" 2>/dev/null | sed "s/^/${CYAN}[Web]${NC} /" &)
(tail -f "$EXTENSION_LOG" 2>/dev/null | sed "s/^/${MAGENTA}[Extension]${NC} /" &)
(tail -f "$MODEL_LOG" 2>/dev/null | sed "s/^/${YELLOW}[Model]${NC} /" &)

# 종료 시 모든 tail 프로세스 정리
trap "pkill -P $$; exit" INT TERM

# 대기
wait

