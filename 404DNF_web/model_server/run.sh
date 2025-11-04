#!/bin/bash

# model_server 실행 스크립트

cd "$(dirname "$0")"

echo "🚀 Model Server 시작 중..."
echo "📍 경로: $(pwd)"

# conda 환경 활성화 (base 환경)
if command -v conda &> /dev/null; then
    echo "📦 Conda 환경 활성화 중..."
    eval "$(conda shell.bash hook)"
    conda activate base
fi

# Python 실행
python app.py

