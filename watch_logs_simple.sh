#!/bin/bash

# 가장 간단한 방법: 3개 로그를 한번에 tail -f로 보기

echo "📊 3개 서버 로그 실시간 모니터링"
echo "종료: Ctrl+C"
echo "========================================="
echo ""

tail -f /tmp/web_server.log /tmp/extension_server.log /tmp/model_server.log 2>/dev/null

