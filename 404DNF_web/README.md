# web
다크패턴 탐지 서비스 웹사이트 통합


### model_server 폴더
model_server 파일에 Flask로 백엔드 구현

front에서 이미지 파일명 보내주면, 모델 돌려서 몽고디비에 저장 후 완료 메시지 보내줌

```
web/
├── model_server/
│   ├── app.py
│   ├── model/
│   │   ├──label_encoders
│   │   ├──dual_classifier_model.pth ✅ 모델 위치
│   │   └── python 실행 파일들
│   ├── .env
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── requirements.txt
├── server/
│   └── input_image/
```
pth 파일은 고용량이어서, ✅ 모델 위치 보고 구글 드라이브에서 다운 받아서 넣어주시면 됩니다!
[파일 다운로드 링크](https://drive.google.com/file/d/1_m9N-IpxXITg5KNO9VLFrELi8dTn9qel/view?usp=sharing)


[실행 방법]
cd web/model_server
```
# 최초 한 번만 (또는 코드 수정 후)
docker-compose up --build
# 일반 실행
docker-compose up
```
docker-compose build (빌드했는데 중간에 코드 수정한 경우)
docker-compose up


