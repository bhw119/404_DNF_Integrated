from flask import Flask, request, jsonify
from pymongo import MongoClient
from dotenv import load_dotenv
import os
import re
import sys
import threading
import time
from datetime import datetime
from model.predictor import process_image_and_predict, process_text_and_predict, parse_text_blocks

# stdout 버퍼링 비활성화 (로그 즉시 출력)
sys.stdout.reconfigure(line_buffering=True)

# 현재 디렉토리와 상위 디렉토리에서 .env 파일 로드
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))  # model_server/.env
load_dotenv(os.path.join(BASE_DIR, '..', '.env'))  # 상위 디렉토리 .env
load_dotenv(os.path.join(BASE_DIR, '..', 'server', '.env'))  # server/.env

app = Flask(__name__)

# MongoDB 연결
MONGODB_URL = os.getenv("MONGODB_URL") or os.getenv("MONGODB_URI")
if not MONGODB_URL:
    print("\n" + "=" * 80)
    print("❌ [MongoDB 연결 오류] MONGODB_URL 또는 MONGODB_URI 환경변수가 설정되지 않았습니다.")
    print("=" * 80)
    print(".env 파일에 다음을 추가하세요:")
    print("MONGODB_URL=mongodb+srv://user:password@cluster.mongodb.net/web?retryWrites=true&w=majority")
    print("=" * 80 + "\n")
    import sys
    sys.exit(1)

# MongoDB URL에서 자격증명 숨기기
masked_url = re.sub(r'://.*@', '://***:***@', MONGODB_URL) if MONGODB_URL else 'localhost:27017'
print(f"\n🔗 [MongoDB 연결 시도] {masked_url}")

try:
    client = MongoClient(MONGODB_URL)
    # 연결 테스트
    client.admin.command('ping')
    db = client["web"]
    predicate_col = db["predicate"]
    extension_col = db["extension"]
    model_col = db["model"]
    print(f"✅ [MongoDB 연결 성공] Database: {db.name}")
    print(f"   - Collections: predicate, extension, model")
    print("=" * 80 + "\n")
except Exception as e:
    print(f"\n❌ [MongoDB 연결 실패] {str(e)}")
    print("=" * 80)
    print("MongoDB 연결을 확인하세요:")
    print("1. .env 파일에 MONGODB_URL이 올바르게 설정되어 있는지 확인")
    print("2. MongoDB Atlas의 네트워크 접근 설정 확인")
    print("3. 인터넷 연결 확인")
    print("=" * 80 + "\n")
    import sys
    sys.exit(1)

# input_image는 server 디렉토리에 있음
INPUT_IMAGE_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "server", "input_image"))

@app.route("/health", methods=["GET"])
def health():
    """서버 상태 확인 엔드포인트"""
    try:
        # MongoDB 연결 확인
        client.admin.command('ping')
        return jsonify({
            "status": "healthy",
            "mongodb": "connected",
            "timestamp": datetime.now().isoformat()
        }), 200
    except Exception as e:
        return jsonify({
            "status": "unhealthy",
            "mongodb": "disconnected",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }), 503

@app.route("/predict", methods=["POST"])
def predict():
    data = request.get_json()
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "filename 누락됨"}), 400

    img_path = os.path.join(INPUT_IMAGE_DIR, filename)
    if not os.path.exists(img_path):
        return jsonify({"error": f"{img_path} 경로에 이미지가 존재하지 않습니다."}), 404

    try:
        prediction_results = process_image_and_predict(img_path)

        # ✅ 예측 결과에 filename 추가
        for result in prediction_results:
            result["filename"] = filename

        # ✅ 다크패턴인 경우만 필터링해서 저장
        dark_patterns_only = [r for r in prediction_results if r.get("is_darkpattern") == 1]

        if dark_patterns_only:
            predicate_col.insert_many(dark_patterns_only)

        return jsonify({
            "message": "✅ 예측 완료",
            "total": len(prediction_results),
            "saved": len(dark_patterns_only)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def watch_extension_collection():
    """
    MongoDB extension 컬렉션의 변경 사항을 감지하고 
    새로운 문서가 추가되면 fullText를 * 기준으로 분리하여 모델링하고 결과를 model 컬렉션에 저장
    """
    print("\n" + "=" * 80)
    print("🔍 [MongoDB 감시 시작] Extension 컬렉션 감시 중")
    print("=" * 80 + "\n")
    
    # 처리된 문서 ID를 추적 (중복 처리 방지)
    processed_ids = set()
    retry_count = 0
    max_retries = 3
    
    while retry_count < max_retries:
        try:
            # MongoDB 연결 확인
            try:
                client.admin.command('ping')
            except Exception as conn_err:
                print(f"\n❌ [MongoDB 연결 확인 실패] {str(conn_err)}")
                print("MongoDB 연결을 확인하고 재시도합니다")
                retry_count += 1
                if retry_count < max_retries:
                    time.sleep(5)
                    continue
                else:
                    print("\n❌ [최대 재시도 횟수 초과] MongoDB 연결에 실패했습니다.")
                    print("서버를 재시작하거나 MongoDB 설정을 확인하세요.")
                    return
            
            # Change Stream으로 실시간 변경 감지
            print("✅ [Change Stream 연결 성공] 새 문서 감지 대기 중")
            print("=" * 80 + "\n")
            sys.stdout.flush()
            
            with extension_col.watch([{"$match": {"operationType": "insert"}}]) as stream:
                retry_count = 0  # 성공적으로 스트림이 시작되면 재시도 카운트 리셋
                print("👀 [Change Stream 활성화] MongoDB extension 컬렉션 감시 중\n")
                sys.stdout.flush()
                
                for change in stream:
                    if change["operationType"] == "insert":
                        doc = change["fullDocument"]
                        doc_id = doc.get("_id")
                        
                        # 이미 처리된 문서는 스킵
                        if doc_id in processed_ids:
                            continue
                        
                        # fullText(번역된 텍스트)와 originalText(원본 텍스트) 가져오기
                        full_text = doc.get("fullText")  # 번역된 영어 텍스트 (모델링용) - * 기준으로 구분됨
                        original_text = doc.get("originalText")  # 원본 한글 텍스트 (표시용) - * 기준으로 구분됨
                        
                        if not full_text:
                            print(f"⚠️ [문서 {doc_id}] fullText가 없습니다. 건너뜁니다.")
                            processed_ids.add(doc_id)
                            continue
                        
                        # originalText가 없으면 fullText를 원본으로 사용 (경고)
                        if not original_text:
                            original_text = full_text
                            print(f"⚠️ [문서 {doc_id}] originalText가 없습니다. fullText를 원본으로 사용합니다.")
                        
                        # fullText에 한글이 포함되어 있는지 확인 (모델에 한글이 들어가면 안 됨)
                        import re
                        has_korean_in_fulltext = bool(re.search(r'[가-힣]', full_text))
                        if has_korean_in_fulltext:
                            print(f"⚠️ [경고] fullText에 한글이 포함되어 있습니다!")
                            print(f"   fullText는 반드시 번역된 영어 텍스트여야 합니다.")
                            print(f"   fullText 샘플: {full_text[:200]}")
                            sys.stdout.flush()
                        
                        # 새 문서 감지 로그
                        print("\n" + "=" * 80)
                        print(f"📥 [새로운 크롤링 데이터 감지]")
                        print("=" * 80)
                        print(f"📝 문서 ID: {doc_id}")
                        print(f"📍 URL: {doc.get('tabUrl', 'N/A')}")
                        print(f"📄 제목: {doc.get('tabTitle', 'N/A')}")
                        print(f"📊 프레임 수: {doc.get('framesCollected', 0)}개")
                        print(f"📝 텍스트 길이: {len(full_text)} 문자")
                        sys.stdout.flush()
                        
                        # 블록 기준 문장 수 계산
                        sentences = parse_text_blocks(full_text)
                        print(f"📋 문장 수 (# 기준 블록): {len(sentences)}개")
                        print(f"📄 텍스트 미리보기: {full_text[:150]}")
                        print("=" * 80)
                        sys.stdout.flush()
                        
                        try:
                            # 진행 상황 추적을 위한 변수
                            total_count = len(sentences)
                            current_count = [0]  # 리스트로 감싸서 참조 가능하게
                            
                            # Extension 문서에 진행 상황 업데이트
                            def update_progress(current, total):
                                current_count[0] = current
                                try:
                                    extension_col.update_one(
                                        {"_id": doc_id},
                                        {"$set": {
                                            "modelingStatus": "processing",
                                            "modelingProgress": {"current": current, "total": total}
                                        }}
                                    )
                                except Exception as e:
                                    print(f"⚠️ [진행 상황 업데이트 실패] {str(e)}")
                            
                            # 모델링 시작 상태 업데이트
                            extension_col.update_one(
                                {"_id": doc_id},
                                {"$set": {
                                    "modelingStatus": "processing",
                                    "modelingProgress": {"current": 0, "total": total_count}
                                }}
                            )
                            
                            print(f"\n🔄 [모델링 시작] {total_count}개 문장 처리 예정\n")
                            sys.stdout.flush()
                            
                            # originalText/translatedText 블록 파싱
                            original_sentences = parse_text_blocks(original_text)
                            translated_sentences = sentences
                            
                            # 원본과 번역된 문장 수가 같은지 확인
                            if len(original_sentences) != len(translated_sentences):
                                print(f"⚠️ [경고] 원본 문장 수({len(original_sentences)})와 번역 문장 수({len(translated_sentences)})가 다릅니다.")
                                print(f"   원본 문장 수에 맞춰 매핑합니다.")
                                sys.stdout.flush()
                            
                            # fullText를 * 기준으로 분리하여 모델 실행 (진행 상황 콜백 전달)
                            print("🚀 [모델 실행 시작] process_text_and_predict() 호출")
                            sys.stdout.flush()
                            
                            results = process_text_and_predict(full_text, progress_callback=update_progress)
                            
                            # 결과에 원본 텍스트 매핑 (인덱스 기반)
                            # 중요: original_sentences와 translated_sentences의 순서가 일치해야 함
                            print(f"📝 [원본 텍스트 매핑] 원본: {len(original_sentences)}개, 번역: {len(translated_sentences)}개, 결과: {len(results)}개")
                            sys.stdout.flush()
                            
                            for idx, result in enumerate(results):
                                # 같은 인덱스의 원본 텍스트 매핑
                                if idx < len(original_sentences):
                                    result["original_text"] = original_sentences[idx]
                                    # 디버깅: 처음 몇 개만 로그 출력
                                    if idx < 3:
                                        print(f"   [{idx+1}] 원본 매핑: {original_sentences[idx][:50]}")
                                        sys.stdout.flush()
                                elif idx < len(translated_sentences):
                                    # 원본이 없으면 번역된 텍스트를 원본으로 사용 (비권장)
                                    result["original_text"] = translated_sentences[idx]
                                    print(f"   ⚠️ [{idx+1}] 원본 없음, 번역본 사용: {translated_sentences[idx][:50]}")
                                    sys.stdout.flush()
                                else:
                                    # 인덱스가 범위를 벗어나면 result의 text 사용 (비권장)
                                    result["original_text"] = result.get("text", "")
                                    print(f"   ⚠️ [{idx+1}] 인덱스 범위 초과, result.text 사용: {result.get('text', '')[:50]}")
                                    sys.stdout.flush()
                            
                            print(f"\n✅ [모델링 완료] 총 {len(results)}개 텍스트 처리 완료\n")
                            sys.stdout.flush()
                            
                            if not results:
                                print(f"⚠️ [경고] 결과가 없습니다. 텍스트를 확인해주세요.\n")
                                processed_ids.add(doc_id)
                                continue
                            
                            # 다크패턴 통계
                            dark_count = sum(1 for r in results if r.get("is_darkpattern") == 1)
                            normal_count = len(results) - dark_count
                            print("=" * 80)
                            print(f"📊 [모델링 결과 통계]")
                            print(f"   - 총 처리: {len(results)}개")
                            print(f"   - 다크패턴: {dark_count}개")
                            print(f"   - 일반: {normal_count}개")
                            print(f"   - 다크패턴 비율: {round(dark_count/len(results)*100, 1)}%")
                            print("=" * 80)
                            
                            # 각 텍스트별 결과를 MongoDB에 저장
                            print(f"\n💾 [MongoDB 저장 시작] 결과를 model 컬렉션에 저장 중\n")
                            saved_count = 0
                            dark_saved = 0
                            
                            for idx, result in enumerate(results, 1):
                                try:
                                    # 요청된 필드 형식으로 저장
                                    prob_value = result.get("probability")
                                    # probability를 0~100 정수로 변환 (0.9234 -> 92)
                                    probability_int = int(round(prob_value * 100)) if prob_value is not None else None
                                    is_dark = result.get("is_darkpattern", 0)
                                    
                                    # 원본 텍스트 가져오기 (original_text가 확실히 설정되어 있어야 함)
                                    original_string = result.get("original_text")
                                    if not original_string:
                                        # original_text가 없으면 원본 sentences에서 직접 가져오기 시도
                                        result_idx = idx - 1  # enumerate는 1부터 시작하므로 -1
                                        if result_idx < len(original_sentences):
                                            original_string = original_sentences[result_idx]
                                            print(f"   ⚠️ [{idx}] original_text가 비어있어서 original_sentences에서 직접 가져옴")
                                        else:
                                            # 최후의 수단: 번역된 텍스트 사용
                                            original_string = result.get("text", "")
                                            print(f"   ⚠️ [{idx}] original_text가 없어서 번역본 사용 (비권장)")
                                    
                                    translated_string = result.get("text", "")  # 번역된 텍스트
                                    
                                    # 디버깅: 다크패턴인 경우 원본 텍스트 확인
                                    if is_dark and idx <= 3:
                                        print(f"   🔍 [{idx}] 다크패턴 저장 - 원본: {original_string[:60]}")
                                        sys.stdout.flush()
                                    
                                    result_doc = {
                                        "string": original_string,  # 원본 텍스트 (표시용) - 반드시 원본이어야 함
                                        "translatedString": translated_string,  # 번역된 텍스트 (참고용)
                                        "type": result.get("type"),  # 다크패턴 유형
                                        "predicate": result.get("predicate"),  # predicate
                                        "probability": probability_int,  # 예측 확률값 (0~100 정수)
                                        "is_darkpattern": is_dark,  # 다크패턴 여부
                                        "id": str(doc_id),  # extension 문서 ID
                                        # _id는 MongoDB가 자동 생성
                                    }
                                    model_col.insert_one(result_doc)
                                    saved_count += 1
                                    if is_dark:
                                        dark_saved += 1
                                    
                                    # 진행 상황 로그 (10개마다 또는 다크패턴인 경우)
                                    if idx % 10 == 0 or is_dark == 1:
                                        status = "🔴 다크패턴" if is_dark else "⚪ 일반"
                                        print(f"   [{idx}/{len(results)}] {status} 저장: {original_string[:60]}")
                                        
                                except Exception as save_error:
                                    print(f"❌ [저장 실패 {idx}/{len(results)}] {str(save_error)}")
                                    import traceback
                                    traceback.print_exc()
                            
                            # 모델링 완료 상태 업데이트
                            extension_col.update_one(
                                {"_id": doc_id},
                                {"$set": {
                                    "modelingStatus": "completed",
                                    "modelingProgress": {"current": len(results), "total": len(results)},
                                    "modelingCompletedAt": datetime.now()
                                }}
                            )
                            
                            # 처리 완료 표시
                            processed_ids.add(doc_id)
                            print("\n" + "=" * 80)
                            print(f"✅ [처리 완료] 문서 {doc_id}")
                            print(f"   - 총 저장: {saved_count}/{len(results)}개")
                            print(f"   - 다크패턴 저장: {dark_saved}개")
                            print(f"   - Collection: model")
                            print(f"   - 저장 시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
                            print("=" * 80 + "\n")
                            sys.stdout.flush()
                            
                        except Exception as e:
                            # 모델링 실패 상태 업데이트
                            try:
                                extension_col.update_one(
                                    {"_id": doc_id},
                                    {"$set": {
                                        "modelingStatus": "failed",
                                        "modelingError": str(e)
                                    }}
                                )
                            except:
                                pass
                            
                            print(f"\n❌ [오류 발생] 문서 {doc_id} 처리 중 오류:")
                            print(f"   {str(e)}")
                            import traceback
                            traceback.print_exc()
                            print("=" * 80 + "\n")
                            sys.stdout.flush()
                            # 오류가 발생해도 processed_ids에 추가하여 무한 반복 방지
                            processed_ids.add(doc_id)
                        
        except Exception as e:
            print(f"\n❌ [Change Stream 오류]")
            print(f"   오류: {str(e)}")
            import traceback
            traceback.print_exc()
            
            # 연결 오류인 경우 재시도
            if "Connection" in str(e) or "ServerSelectionTimeoutError" in str(type(e).__name__):
                retry_count += 1
                if retry_count < max_retries:
                    print(f"   {5 * retry_count}초 후 재시도합니다 ({retry_count}/{max_retries})\n")
                    time.sleep(5 * retry_count)
                    continue
                else:
                    print(f"\n❌ [최대 재시도 횟수 초과] MongoDB 연결에 실패했습니다.")
                    print("서버를 재시작하거나 MongoDB 설정을 확인하세요.\n")
                    return
            else:
                # 다른 오류인 경우 재시도
                print(f"   5초 후 재시도합니다\n")
                time.sleep(5)
                continue

def start_watcher():
    """백그라운드에서 MongoDB 감시를 시작하는 스레드"""
    watcher_thread = threading.Thread(target=watch_extension_collection, daemon=True)
    watcher_thread.start()
    print("✅ [시스템] MongoDB 감시 스레드 시작됨")
    print("   - Extension 컬렉션 감시 중")
    print("   - 새 문서 감지 시 자동으로 모델링 수행\n")

if __name__ == "__main__":
    import socket
    
    PORT = int(os.getenv("PORT", 5005))  # 환경변수로 포트 설정 가능
    
    # 포트 충돌 확인 및 처리
    print("\n" + "=" * 80)
    print("🔍 [포트 확인] 포트 충돌 체크 중")
    print("=" * 80)
    
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('127.0.0.1', PORT))
    sock.close()
    
    if result == 0:
        print(f"\n❌ [포트 충돌] 포트 {PORT}가 이미 사용 중입니다.")
        print("=" * 80)
        print("다음 중 하나를 선택하세요:")
        print(f"1. 기존 프로세스 종료: lsof -ti:{PORT} | xargs kill -9")
        print(f"2. 환경변수로 다른 포트 사용: PORT=5006 python app.py")
        print("=" * 80 + "\n")
        import sys
        sys.exit(1)
    else:
        print(f"✅ [포트 확인] 포트 {PORT} 사용 가능")
        print("=" * 80 + "\n")
        
        # Flask 서버 시작 전에 MongoDB 감시 시작
        start_watcher()
        
        print("\n" + "=" * 80)
        print(f"🚀 [Model 서버 시작]")
        print("=" * 80)
        print(f"📍 포트: {PORT}")
        print(f"🌐 URL: http://localhost:{PORT}")
        print("=" * 80 + "\n")
        
        app.run(host="0.0.0.0", port=PORT)