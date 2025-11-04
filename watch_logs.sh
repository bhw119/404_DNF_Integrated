#!/bin/bash

# 3개 서버의 로그를 동시에 실시간으로 보는 스크립트

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

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}📊 서버 로그 실시간 모니터링${NC}"
echo -e "${BLUE}========================================${NC}\n"

echo -e "${GREEN}📋 로그 파일:${NC}"
echo -e "   ${CYAN}Web 서버:${NC}      $WEB_LOG"
echo -e "   ${MAGENTA}Extension 서버:${NC} $EXTENSION_LOG"
echo -e "   ${YELLOW}Model 서버:${NC}     $MODEL_LOG"
echo -e ""
echo -e "${YELLOW}💡 종료하려면 Ctrl+C를 누르세요${NC}\n"
echo -e "${BLUE}========================================${NC}\n"

# 로그 파일이 없으면 생성
touch "$WEB_LOG" "$EXTENSION_LOG" "$MODEL_LOG"

# 각 로그 파일에 색상 태그를 추가하여 tail -f로 실시간 표시
# awk를 사용하여 각 줄 앞에 서버 이름과 색상 추가
tail -f "$WEB_LOG" "$EXTENSION_LOG" "$MODEL_LOG" 2>/dev/null | while IFS= read -r line; do
    # 어떤 파일에서 온 로그인지 확인하고 색상 적용
    case "$line" in
        *"/tmp/web_server.log"*)
            echo -e "${CYAN}[Web]${NC} ${line#*: }"
            ;;
        *"/tmp/extension_server.log"*)
            echo -e "${MAGENTA}[Extension]${NC} ${line#*: }"
            ;;
        *"/tmp/model_server.log"*)
            echo -e "${YELLOW}[Model]${NC} ${line#*: }"
            ;;
        *)
            echo "$line"
            ;;
    esac
done

