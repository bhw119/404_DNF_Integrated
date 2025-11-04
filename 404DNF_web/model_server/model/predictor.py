import easyocr
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification, AutoModelForSeq2SeqLM
from sentence_transformers import SentenceTransformer
from torch_geometric.data import Data, Batch
import joblib
import json
import os
import sys
import pandas as pd
from model.resgcn import ResGCN_Improved

# stdout 버퍼링 비활성화 (로그 즉시 출력)
sys.stdout.reconfigure(line_buffering=True)

# 현재 파일의 디렉토리 경로 가져오기
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR)

# 디바이스 설정
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# OCR 엔진 초기화
reader = easyocr.Reader(['en', 'ko'])

# 1단계 HuggingFace 모델 로드 (is_darkpattern 여부 판단)
dp_tokenizer = AutoTokenizer.from_pretrained("h4shk4t/darkpatternLLM-multiclass")
dp_model = AutoModelForSequenceClassification.from_pretrained("h4shk4t/darkpatternLLM-multiclass")
dp_model.to(device)
dp_model.eval()

class_map = {
    0: "scarcity",
    1: "misdirection",
    2: "Not_Dark_Pattern",
    3: "obstruction",
    4: "forced_action",
    5: "sneaking",
    6: "social_proof",
    7: "urgency"
}

# 번역 모델 로드 (영->한)
trans_model_name = "Helsinki-NLP/opus-mt-ko-en"
trans_tokenizer = AutoTokenizer.from_pretrained(trans_model_name)
trans_model = AutoModelForSeq2SeqLM.from_pretrained(trans_model_name).to(device)

# 2단계 ResGCN 모델 로드 (predicate 예측)
# SentenceTransformer 로드 (임베딩 생성용)
st_model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2', device=device)
print(f"✅ SentenceTransformer 로드 완료 (device: {device})")

# ResGCN 모델 로드
model_path = os.path.join(MODEL_DIR, "resgcn_improved.pt")
predicate_encoder = joblib.load(os.path.join(MODEL_DIR, "label_encoders", "predicate_encoder.pkl"))
category_encoder = joblib.load(os.path.join(MODEL_DIR, "label_encoders", "category_encoder.pkl"))

print(f"📦 ResGCN 모델 체크포인트 로드 중: {model_path}")
ckpt = torch.load(model_path, map_location=device)

# 체크포인트에서 모델 하이퍼파라미터 추출
if 'hp' in ckpt:
    hp = ckpt['hp']
    in_dim = hp.get('in_dim', 768)  # all-mpnet-base-v2의 차원
    hidden = hp.get('hidden', 128)
    num_blocks = hp.get('layers', 2)
else:
    # 기본값 사용 (ckpt에 hp가 없는 경우)
    in_dim = 768
    hidden = 128
    num_blocks = 2
    print("⚠️  체크포인트에 hp 정보가 없어 기본값을 사용합니다.")

# state_dict 추출
if 'state_dict' in ckpt:
    state_dict = ckpt['state_dict']
else:
    # 전체 모델이 저장된 경우
    if isinstance(ckpt, dict) and 'model' in ckpt:
        state_dict = ckpt['model']
    else:
        # state_dict가 직접 저장된 경우
        state_dict = ckpt

# 출력 클래스 수는 체크포인트에서 확인하거나 predicate_encoder에서 가져옴
if 'head.weight' in state_dict:
    num_classes = state_dict['head.weight'].shape[0]
    print(f"📊 체크포인트에서 num_classes 확인: {num_classes}")
else:
    num_classes = len(predicate_encoder.classes_)
    print(f"⚠️  체크포인트에 head.weight가 없어 predicate_encoder에서 가져옴: {num_classes}")

print(f"📊 모델 설정: in_dim={in_dim}, hidden={hidden}, num_classes={num_classes}, num_blocks={num_blocks}")

# ResGCN 모델 인스턴스 생성
model = ResGCN_Improved(in_dim=in_dim, hidden=hidden, num_classes=num_classes, num_blocks=num_blocks)

# state_dict 로드
model.load_state_dict(state_dict)
print("✅ 모델 state_dict 로드 완료")

model.to(device)
model.eval()
print(f"✅ ResGCN 모델 로드 완료 (device: {device})")

# 예측 함수 (두 단계 분기 + 번역 포함)
def process_image_and_predict(image_path):
    law_path = os.path.join(MODEL_DIR, "predicate_type_law.csv")
    if os.path.exists(law_path):
        laws_df = pd.read_csv(law_path)
        # predicate, type, laws 모두 포함해야 함 (predicate로 검색하기 위해)
        reduced_law = laws_df[['predicate', 'type', 'laws']].drop_duplicates().reset_index(drop=True)
    else:
        reduced_law = pd.DataFrame(columns=['predicate', 'type', 'laws'])

    ocr_results = reader.readtext(image_path)
    output = []

    for (bbox, text, prob) in ocr_results:
        x_min = int(min(p[0] for p in bbox))
        y_min = int(min(p[1] for p in bbox))
        width = int(max(p[0] for p in bbox)) - x_min
        height = int(max(p[1] for p in bbox)) - y_min

        # 번역: 영어 → 한국어
        input_text = text.strip()
        try:
            trans_inputs = trans_tokenizer.encode(input_text, return_tensors="pt", truncation=True).to(device)
            translated = trans_model.generate(trans_inputs, max_length=100)
            translated_text = trans_tokenizer.decode(translated[0], skip_special_tokens=True)
        except Exception:
            translated_text = input_text  # 번역 실패 시 원문 유지

        # ✅ 예측 기준을 번역된 텍스트로 변경
        # 1단계: 다크패턴 여부 판단
        dp_inputs = dp_tokenizer(translated_text, return_tensors="pt", truncation=True, padding=True).to(device)
        with torch.no_grad():
            logits = dp_model(**dp_inputs).logits
            probs = F.softmax(logits, dim=1)[0]
            pred_class = torch.argmax(probs).item()
            pred_label = class_map[pred_class]

        is_dark = 0 if pred_label == "Not_Dark_Pattern" else 1
        category, predicate, top_preds = None, None, []

        # 2단계: 다크패턴일 경우 predicate 예측 (ResGCN 사용)
        if is_dark:
            try:
                # SentenceTransformer로 임베딩 생성
                with torch.no_grad():
                    embedding = st_model.encode([translated_text], convert_to_tensor=True, device=device)  # [1, 768]
                
                # 1-노드 PyG Data 객체 생성
                x = embedding  # [1, 768]
                edge_index = torch.empty((2, 0), dtype=torch.long, device=device)  # 빈 엣지
                pyg_data = Data(x=x, edge_index=edge_index)
                
                # Batch로 변환
                pyg_batch = Batch.from_data_list([pyg_data])
                pyg_batch = pyg_batch.to(device)
                
                # ResGCN 모델 추론
                with torch.no_grad():
                    logits = model(pyg_batch)  # [1, num_classes]
                
                # 결과 후처리
                pred_probs = F.softmax(logits, dim=-1).cpu().numpy()[0]
                pred_idx = torch.argmax(logits, dim=1).item()
                
                # Predicate 디코딩
                predicate = predicate_encoder.inverse_transform([pred_idx])[0]
                
                # Top 3 predictions
                top_indices = pred_probs.argsort()[::-1][:3]
                top_preds = [
                    f"{predicate_encoder.inverse_transform([i])[0]} ({round(pred_probs[i], 4)})"
                    for i in top_indices
                ]
                
                # Category는 predicate_type_law.csv에서 predicate로부터 매핑
                category = None
                if predicate:
                    category_row = reduced_law[reduced_law["predicate"] == predicate]
                    if not category_row.empty:
                        category = category_row.iloc[0]["type"]
            except Exception as e:
                print(f"[WARNING] ResGCN 예측 실패: {e}")
                predicate = None
                top_preds = []
                category = None

        # 법률 정보 연결
        law_list = []
        if category:
            law_row = reduced_law[reduced_law["type"] == category]
            if not law_row.empty:
                try:
                    law_list = json.loads(law_row.iloc[0]["laws"])
                except Exception as e:
                    print(f"[WARNING] JSON parsing error in laws: {e}")

        output.append({
            "text": text,
            "translated": translated_text,
            "confidence": float(prob),
            "bbox": json.dumps({"x": x_min, "y": y_min, "width": width, "height": height}),
            "is_darkpattern": is_dark,
            "predicate": predicate,
            "top1_predicate": top_preds[0] if len(top_preds) > 0 else None,
            "top2_predicate": top_preds[1] if len(top_preds) > 1 else None,
            "top3_predicate": top_preds[2] if len(top_preds) > 2 else None,
            "category": category,
            "type": category,
            "laws": law_list
        })

    return output

# 텍스트 기반 예측 함수 (* 기준으로 분리)
def process_text_and_predict(full_text, progress_callback=None):
    """
    fullText를 * 기준으로 분리하여 각 텍스트에 대해 모델 예측 수행
    
    Args:
        full_text: *로 구분된 텍스트 문자열
        
    Returns:
        각 텍스트별 예측 결과 리스트
    """
    law_path = os.path.join(MODEL_DIR, "predicate_type_law.csv")
    if os.path.exists(law_path):
        laws_df = pd.read_csv(law_path)
        # predicate, type, laws 모두 포함해야 함 (predicate로 검색하기 위해)
        reduced_law = laws_df[['predicate', 'type', 'laws']].drop_duplicates().reset_index(drop=True)
    else:
        reduced_law = pd.DataFrame(columns=['predicate', 'type', 'laws'])
    
    # * 기준으로 텍스트 분리 (fullText는 이미 번역된 영어 텍스트)
    text_list = [text.strip() for text in full_text.split("*") if text.strip()]
    print(f"📊 [텍스트 분리] * 기준으로 {len(text_list)}개 텍스트 발견 (번역된 영어 텍스트)")
    output = []
    
    for idx, text in enumerate(text_list, 1):
        input_text = text.strip()
        if not input_text:
            continue
        
        # 진행 상황 콜백 호출 (있는 경우)
        if progress_callback:
            try:
                progress_callback(idx, len(text_list))
            except Exception as e:
                print(f"⚠️ [진행 상황 콜백 오류] {str(e)}")
        
        # 진행 상황 로그 (모든 단계에서 출력)
        print(f"  🔄 [{idx}/{len(text_list)}] 모델링 진행 중 ({input_text[:50]})")
        sys.stdout.flush()  # 버퍼 강제 출력
        
        # fullText는 이미 크롬 익스텐션에서 번역된 영어 텍스트
        # 모델에 들어가는 텍스트는 반드시 영어여야 함
        translated_text = input_text  # 이미 번역된 텍스트
        
        # 한글 감지 및 경고 (모델에 한글이 들어가면 안 됨)
        import re
        has_korean = bool(re.search(r'[가-힣]', translated_text))
        if has_korean:
            print(f"     ⚠️ [경고] 모델에 한글 텍스트가 입력되었습니다! (번역 확인 필요)")
            print(f"     입력 텍스트: {translated_text[:100]}")
            sys.stdout.flush()
        
        category, predicate, probability, top_preds = None, None, None, []
        is_dark = 0
        
        # ResGCN 모델로 직접 예측 (1-2단계 구분 없이)
        print(f"     📊 ResGCN 모델 예측 중 (입력: {len(translated_text)}자)")
        sys.stdout.flush()
        
        try:
            # SentenceTransformer로 임베딩 생성
            with torch.no_grad():
                embedding = st_model.encode([translated_text], convert_to_tensor=True, device=device)  # [1, 768]
            
            # 1-노드 PyG Data 객체 생성
            x = embedding  # [1, 768]
            edge_index = torch.empty((2, 0), dtype=torch.long, device=device)  # 빈 엣지 (1-노드 그래프)
            pyg_data = Data(x=x, edge_index=edge_index)
            
            # Batch로 변환 (단일 그래프이므로 배치 크기 1)
            pyg_batch = Batch.from_data_list([pyg_data])
            pyg_batch = pyg_batch.to(device)
            
            # ResGCN 모델 추론
            with torch.no_grad():
                logits = model(pyg_batch)  # [1, num_classes]
            
            # 결과 후처리
            pred_probs = F.softmax(logits, dim=-1).cpu().numpy()[0]  # [num_classes]
            pred_idx = torch.argmax(logits, dim=1).item()
            
            # Predicate 디코딩
            predicate = predicate_encoder.inverse_transform([pred_idx])[0]
            probability = float(pred_probs[pred_idx])
            
            # 다크패턴 여부 판단: predicate가 "Not_Dark_Pattern"이 아니면 다크패턴
            # 또는 확률이 일정 임계값 이상이면 다크패턴으로 판단
            is_not_dark_keywords = ["not_dark", "not_dark_pattern", "normal", "none"]
            is_dark = 1 if not any(keyword in predicate.lower() for keyword in is_not_dark_keywords) else 0
            
            # Top 3 predictions
            top_indices = pred_probs.argsort()[::-1][:3]
            top_preds = [
                f"{predicate_encoder.inverse_transform([i])[0]} ({round(pred_probs[i], 4)})"
                for i in top_indices
            ]
            
            # Category는 predicate_type_law.csv에서 predicate로부터 매핑
            if predicate:
                category_row = reduced_law[reduced_law["predicate"] == predicate]
                if not category_row.empty:
                    category = category_row.iloc[0]["type"]
            
            # 결과 로그
            if is_dark:
                print(f"     🔴 다크패턴 감지: Type={category}, Predicate={predicate}, 확률={round(probability*100, 1)}%")
            else:
                print(f"     ⚪ 일반 텍스트: Predicate={predicate}, 확률={round(probability*100, 1)}%")
            sys.stdout.flush()
            
        except Exception as e:
            print(f"     ❌ ResGCN 예측 실패: {str(e)}")
            import traceback
            traceback.print_exc()
            sys.stdout.flush()
            predicate = None
            probability = None
            top_preds = []
            category = None
            is_dark = 0
        
        # 법률 정보 연결
        law_list = []
        if category:
            law_row = reduced_law[reduced_law["type"] == category]
            if not law_row.empty:
                try:
                    law_list = json.loads(law_row.iloc[0]["laws"])
                except Exception as e:
                    print(f"[WARNING] JSON parsing error in laws: {e}")
        
        output.append({
            "text": translated_text,  # 번역된 텍스트 (모델링에 사용된 텍스트)
            "translated": translated_text,  # 호환성 유지
            "is_darkpattern": is_dark,
            "predicate": predicate,
            "probability": probability,
            "top1_predicate": top_preds[0] if len(top_preds) > 0 else None,
            "top2_predicate": top_preds[1] if len(top_preds) > 1 else None,
            "top3_predicate": top_preds[2] if len(top_preds) > 2 else None,
            "category": category,
            "type": category,
            "laws": law_list
        })
    
    return output