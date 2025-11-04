#!/bin/bash

# 전체 서버 종료 스크립트

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}🛑 서버 종료 중...${NC}"

# PID 파일에서 프로세스 종료
if [ -f /tmp/404dnf_pids.txt ]; then
    PIDS=$(cat /tmp/404dnf_pids.txt)
    for PID in $PIDS; do
        if kill -0 $PID 2>/dev/null; then
            kill $PID 2>/dev/null
            echo -e "${GREEN}✅ 프로세스 $PID 종료됨${NC}"
        fi
    done
    rm /tmp/404dnf_pids.txt
fi

# 프로세스 이름으로 종료 (더 확실함)
pkill -f "nodemon.*server.js" 2>/dev/null && echo -e "${GREEN}✅ nodemon 서버 프로세스 종료됨${NC}" || echo -e "${YELLOW}⚠️  nodemon 서버 프로세스 없음${NC}"
pkill -f "python.*app.py" 2>/dev/null && echo -e "${GREEN}✅ Model 서버 프로세스 종료됨${NC}" || echo -e "${YELLOW}⚠️  Model 서버 프로세스 없음${NC}"

# 포트로 프로세스 종료
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 3000 (Web 서버) 종료됨${NC}" || echo -e "${YELLOW}⚠️  포트 3000에 실행 중인 프로세스 없음${NC}"
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 8000 (Extension 서버) 종료됨${NC}" || echo -e "${YELLOW}⚠️  포트 8000에 실행 중인 프로세스 없음${NC}"
lsof -ti:5005 | xargs kill -9 2>/dev/null && echo -e "${GREEN}✅ 포트 5005 (Model 서버) 종료됨${NC}" || echo -e "${YELLOW}⚠️  포트 5005에 실행 중인 프로세스 없음${NC}"

echo -e "${GREEN}✅ 모든 서버가 종료되었습니다.${NC}"

