# GitHub 저장소 연결 가이드

## 1. GitHub에서 새 저장소 생성

1. GitHub에 로그인
2. 우측 상단의 "+" 버튼 클릭 → "New repository" 선택
3. 저장소 이름 입력 (예: `404dnf-integrated`)
4. 설명 추가 (선택사항)
5. Public 또는 Private 선택
6. **"Initialize this repository with a README"는 체크하지 마세요** (이미 로컬에 파일이 있음)
7. "Create repository" 클릭

## 2. 로컬 저장소와 GitHub 연결

GitHub에서 저장소를 생성한 후, 아래 명령어를 실행하세요:

```bash
# 현재 변경사항 추가
git add .

# 초기 커밋 생성
git commit -m "Initial commit: 통합 프로젝트 구조 설정"

# 브랜치 이름을 main으로 설정 (필요한 경우)
git branch -M main

# GitHub 원격 저장소 추가 (YOUR_USERNAME과 YOUR_REPO_NAME을 실제 값으로 변경)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 변경사항 푸시
git push -u origin main
```

## 3. SSH를 사용하는 경우

SSH 키를 사용하는 경우:

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
git push -u origin main
```

## 4. 기존 저장소가 있는 경우

이미 GitHub에 저장소가 있고 다른 원격 저장소와 연결되어 있다면:

```bash
# 기존 원격 저장소 확인
git remote -v

# 기존 원격 저장소 제거 (필요한 경우)
git remote remove origin

# 새로운 원격 저장소 추가
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 푸시
git push -u origin main
```

## 5. 추후 작업 플로우

일반적인 작업 플로우:

```bash
# 변경사항 확인
git status

# 변경사항 추가
git add .

# 커밋
git commit -m "커밋 메시지"

# 푸시
git push
```

## 문제 해결

### 인증 오류가 발생하는 경우

GitHub는 더 이상 비밀번호 인증을 지원하지 않습니다. Personal Access Token을 사용하세요:

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token" 클릭
3. 필요한 권한 선택 (repo)
4. 토큰 생성 후 복사
5. 푸시 시 비밀번호 대신 토큰 사용

### 충돌이 발생하는 경우

```bash
# 원격 변경사항 가져오기
git pull origin main

# 충돌 해결 후
git add .
git commit -m "Merge conflict resolved"
git push
```

