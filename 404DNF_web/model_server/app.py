from flask import Flask, request, jsonify
from pymongo import MongoClient
from dotenv import load_dotenv
import os
import re
import sys
import threading
import time
import socket
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional
from model.predictor import process_image_and_predict, process_text_and_predict, parse_text_blocks

# stdout 버퍼링 비활성화 (로그 즉시 출력)
sys.stdout.reconfigure(line_buffering=True)

# 현재 디렉토리와 상위 디렉토리에서 .env 파일 로드
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, '.env'))  # model_server/.env
load_dotenv(os.path.join(BASE_DIR, '..', '.env'))  # 상위 디렉토리 .env
load_dotenv(os.path.join(BASE_DIR, '..', 'server', '.env'))  # server/.env

app = Flask(__name__)

# 동시 실행 시 충돌 방지를 위한 서버 인스턴스 식별자
SERVER_INSTANCE_ID = os.getenv("MODEL_SERVER_INSTANCE_ID")
if not SERVER_INSTANCE_ID:
    hostname = socket.gethostname()
    pid = os.getpid()
    SERVER_INSTANCE_ID = f"{hostname}-{pid}-{uuid.uuid4().hex[:6]}"
print(f"🆔 [Model Server Instance] {SERVER_INSTANCE_ID}")

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

                    # 다른 인스턴스가 처리 중인지 확인
                    existing_processor = doc.get("processingServerId")
                    if existing_processor and existing_processor != SERVER_INSTANCE_ID:
                        print(f"⚠️ [선점됨] 문서 {doc_id}는 다른 서버({existing_processor})가 처리 중입니다. 건너뜁니다.")
                        processed_ids.add(doc_id)
                        continue

                    # 처리권 선점 (원자적 업데이트)
                    if not existing_processor:
                        claim_result = extension_col.update_one(
                            {"_id": doc_id, "processingServerId": {"$exists": False}},
                            {"$set": {"processingServerId": SERVER_INSTANCE_ID}}
                        )
                        if claim_result.modified_count == 0:
                            claimed_doc = extension_col.find_one({"_id": doc_id}, {"processingServerId": 1})
                            claimed_by = claimed_doc.get("processingServerId") if claimed_doc else None
                            if claimed_by and claimed_by != SERVER_INSTANCE_ID:
                                print(f"⚠️ [경쟁 감지] 문서 {doc_id}는 다른 서버({claimed_by})가 선점했습니다. 건너뜁니다.")
                                processed_ids.add(doc_id)
                                continue
                        doc["processingServerId"] = SERVER_INSTANCE_ID
                        
                        # fullText(번역된 텍스트)와 originalText(원본 텍스트) 가져오기
                        full_text = doc.get("fullText")  # 번역된 영어 텍스트 (모델링용) - * 기준으로 구분됨
                        original_text = doc.get("originalText")  # 원본 한글 텍스트 (표시용) - * 기준으로 구분됨
                        structured_blocks = doc.get("structuredBlocks")
                        
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
                            # structuredBlocks 기반 블록 구성 (태그/셀렉터 유지)
                            def star_to_plain(value: Optional[str]) -> str:
                                if not value:
                                    return ""
                                text_value = str(value).replace("*", " ")
                                return re.sub(r"\s+", " ", text_value).strip()
                            
                            block_entries: List[Dict[str, Any]] = []
                            if isinstance(structured_blocks, list) and structured_blocks:
                                for blk in structured_blocks:
                                    if not isinstance(blk, dict):
                                        continue
                                    translated_star = blk.get("text") or blk.get("plainText") or ""
                                    translated_plain = blk.get("translatedPlainText") or star_to_plain(translated_star)
                                    original_star = blk.get("originalText") or blk.get("rawText") or translated_star
                                    original_plain = blk.get("originalPlainText") or blk.get("rawPlainText") or star_to_plain(original_star)
                                    if not translated_plain and not original_plain:
                                        continue
                                    block_entries.append({
                                        "translated_star": translated_star,
                                        "translated_plain": translated_plain,
                                        "original_star": original_star,
                                        "original_plain": original_plain,
                                        "meta": {
                                            "index": blk.get("index"),
                                            "selector": blk.get("selector"),
                                            "tag": blk.get("tag"),
                                            "frameUrl": blk.get("frameUrl"),
                                            "frameTitle": blk.get("frameTitle"),
                                            "frameBlockIndex": blk.get("frameBlockIndex"),
                                            "blockType": blk.get("blockType"),
                                            "frameId": blk.get("frameId"),
                                            "linkHref": blk.get("linkHref"),
                                        }
                                    })
                            else:
                                translated_sentences = parse_text_blocks(full_text)
                                original_sentences = parse_text_blocks(original_text)
                                for idx, translated_plain in enumerate(translated_sentences):
                                    original_plain = original_sentences[idx] if idx < len(original_sentences) else translated_plain
                                    block_entries.append({
                                        "translated_star": translated_plain,
                                        "translated_plain": translated_plain,
                                        "original_star": original_plain,
                                        "original_plain": original_plain,
                                        "meta": {
                                            "index": idx,
                                            "linkHref": None
                                        }
                                    })
                            
                            # 중복 블록 제거 (텍스트 기준)
                            unique_entries = []
                            seen_entries = set()
                            for entry in block_entries:
                                text_key = (entry.get("original_plain") or entry.get("translated_plain") or "").strip().lower()
                                if not text_key:
                                    continue
                                if text_key in seen_entries:
                                    continue
                                seen_entries.add(text_key)
                                unique_entries.append(entry)
                            block_entries = unique_entries

                            total_count = len(block_entries)
                            if total_count == 0:
                                print(f"⚠️ [경고] 처리할 블록이 없습니다. 문서 {doc_id} 건너뜁니다.")
                                processed_ids.add(doc_id)
                                continue
                            
                            current_count = [0]
                            
                            def update_progress(current, total):
                                current_count[0] = current
                                try:
                                    extension_col.update_one(
                                        {"_id": doc_id},
                                        {"$set": {
                                            "modelingStatus": "processing",
                                            "modelingProgress.current": current,
                                            "modelingProgress.total": total_count,
                                            "processingServerId": SERVER_INSTANCE_ID
                                        }}
                                    )
                                except Exception as e:
                                    print(f"⚠️ [진행 상황 업데이트 실패] {str(e)}")
                            
                            extension_col.update_one(
                                {"_id": doc_id},
                                {"$set": {
                                    "modelingStatus": "processing",
                                    "modelingProgress": {"current": 0, "total": total_count},
                                    "processingServerId": SERVER_INSTANCE_ID
                                }}
                            )
                            
                            print(f"\n🔄 [모델링 시작] {total_count}개 블록 처리 예정\n")
                            sys.stdout.flush()
                            
                            print("🚀 [모델 실행 시작] process_text_and_predict() 호출")
                            sys.stdout.flush()
                            
                            translated_list_for_model = [entry["translated_plain"] for entry in block_entries]
                            results = process_text_and_predict(translated_list_for_model, progress_callback=update_progress)
                            
                            print(f"📝 [원본 텍스트 매핑] 블록: {len(block_entries)}개, 결과: {len(results)}개")
                            sys.stdout.flush()
                            
                            for idx, result in enumerate(results):
                                if idx >= len(block_entries):
                                    break
                                entry = block_entries[idx]
                                result["original_text"] = entry["original_plain"]
                                result["structured_meta"] = entry["meta"]
                                result["translated_text"] = entry["translated_plain"]
                                if idx < 3:
                                    preview = entry["original_plain"] or entry["translated_plain"]
                                    print(f"   [{idx+1}] 원본 매핑: {preview[:50]}")
                                    sys.stdout.flush()
                            
                            print(f"\n✅ [모델링 완료] 총 {len(results)}개 텍스트 처리 완료\n")
                            sys.stdout.flush()
                            
                            if not results:
                                print(f"⚠️ [경고] 결과가 없습니다. 텍스트를 확인해주세요.\n")
                                processed_ids.add(doc_id)
                                continue
                            
                            dark_count = sum(1 for r in results if r.get("is_darkpattern") == 1)
                            normal_count = len(results) - dark_count
                            print("=" * 80)
                            print(f"📊 [모델링 결과 통계]")
                            print(f"   - 총 처리: {len(results)}개")
                            print(f"   - 다크패턴: {dark_count}개")
                            print(f"   - 일반: {normal_count}개")
                            print(f"   - 다크패턴 비율: {round(dark_count/len(results)*100, 1)}%")
                            print("=" * 80)
                            
                            print(f"\n💾 [MongoDB 저장 시작] 결과를 model 컬렉션에 저장 중\n")
                            saved_count = 0
                            dark_saved = 0
                            seen_result_docs = set()
                            
                            for idx, result in enumerate(results, 1):
                                try:
                                    prob_value = result.get("probability")
                                    probability_int = int(round(prob_value * 100)) if prob_value is not None else None
                                    is_dark = result.get("is_darkpattern", 0)
                                    
                                    entry = block_entries[idx - 1] if (idx - 1) < len(block_entries) else None
                                    original_string = result.get("original_text") or (entry.get("original_plain") if entry else "")
                                    translated_string = result.get("translated_text") or (entry.get("translated_plain") if entry else result.get("text", ""))
                                    
                                    if is_dark and idx <= 3:
                                        print(f"   🔍 [{idx}] 다크패턴 저장 - 원본: {original_string[:60]}")
                                        sys.stdout.flush()

                                    normalized_original = original_string.strip().lower()
                                    if normalized_original in seen_result_docs:
                                        continue
                                    seen_result_docs.add(normalized_original)
                                    
                                    meta_info = result.get("structured_meta") or (entry.get("meta") if entry else None)
                                    link_href_value = None
                                    link_selector_value = None
                                    if isinstance(meta_info, dict):
                                        link_href_value = meta_info.get("linkHref")
                                        link_selector_value = meta_info.get("linkSelector")

                                    result_doc = {
                                        "string": original_string,
                                        "translatedString": translated_string,
                                        "type": result.get("type"),
                                        "predicate": result.get("predicate"),
                                        "probability": probability_int,
                                        "is_darkpattern": is_dark,
                                        "id": str(doc_id),
                                        "structuredMeta": meta_info,
                                        "linkHref": link_href_value,
                                        "linkSelector": link_selector_value
                                    }
                                    model_col.insert_one(result_doc)
                                    saved_count += 1
                                    if is_dark:
                                        dark_saved += 1
                                    
                                    if idx % 10 == 0 or is_dark == 1:
                                        status = "🔴 다크패턴" if is_dark else "⚪ 일반"
                                        print(f"   [{idx}/{len(results)}] {status} 저장: {original_string[:60]}")
                                except Exception as save_error:
                                    print(f"❌ [저장 실패 {idx}/{len(results)}] {str(save_error)}")
                                    import traceback
                                    traceback.print_exc()
                            
                            extension_col.update_one(
                                {"_id": doc_id},
                                {"$set": {
                                    "modelingStatus": "completed",
                                    "modelingProgress": {"current": len(results), "total": total_count},
                                    "modelingCompletedAt": datetime.now(),
                                    "processingServerId": SERVER_INSTANCE_ID
                                }}
                            )
                            
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
                                        "modelingError": str(e),
                                        "processingServerId": SERVER_INSTANCE_ID
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