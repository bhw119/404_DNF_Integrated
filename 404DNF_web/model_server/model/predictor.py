import easyocr
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from sentence_transformers import SentenceTransformer
from torch_geometric.data import Data
import numpy as np
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import LabelEncoder
import json
import os
import sys
import pandas as pd
import re
from model.resgcn import ResGCN

# stdout 버퍼링 비활성화 (로그 즉시 출력)
sys.stdout.reconfigure(line_buffering=True)

# 현재 파일의 디렉토리 경로 가져오기
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR)

# 디바이스 설정
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# OCR 엔진 초기화 (이미지 분석용)
reader = easyocr.Reader(['en', 'ko'])

# 번역 모델 로드 (영->한, 이미지 분석용)
trans_model_name = "Helsinki-NLP/opus-mt-ko-en"
trans_tokenizer = AutoTokenizer.from_pretrained(trans_model_name)
trans_model = AutoModelForSeq2SeqLM.from_pretrained(trans_model_name).to(device)

# ResGCN 모델 로드 (노트북 구조 기반)
# SentenceTransformer 로드 (임베딩 생성용)
st_model = SentenceTransformer('sentence-transformers/all-mpnet-base-v2', device=device)
print(f"✅ SentenceTransformer 로드 완료 (device: {device})")

# 모델 파일 경로
model_path = os.path.join(MODEL_DIR, "resgcn_improved.pt")
embeddings_path = os.path.join(MODEL_DIR, "embeddings_improved.npy")
meta_path = os.path.join(MODEL_DIR, "embeddings_meta.json")

# embeddings_meta.json 로드
if os.path.exists(meta_path):
    with open(meta_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)
    print(f"✅ 메타데이터 로드 완료: {meta_path}")
    print(f"   - knn_k: {meta.get('knn_k', 10)}")
    print(f"   - mutual_knn: {meta.get('mutual_knn', True)}")
    print(f"   - metric: {meta.get('metric', 'cosine')}")
    print(f"   - classes: {len(meta.get('classes', []))}개")
else:
    print(f"⚠️  메타데이터 파일이 없습니다: {meta_path}")
    print("   기본값을 사용합니다.")
    meta = {
        'knn_k': 10,
        'mutual_knn': True,
        'metric': 'cosine',
        'classes': []
    }

# Train embeddings 로드 (inductive inference용)
if os.path.exists(embeddings_path):
    X_train = np.load(embeddings_path)
    print(f"✅ Train embeddings 로드 완료: {embeddings_path}")
    print(f"   - Shape: {X_train.shape}")
else:
    print(f"⚠️  Train embeddings 파일이 없습니다: {embeddings_path}")
    print("   단일 노드 그래프로 추론합니다 (권장하지 않음).")
    X_train = None

# ResGCN 모델 체크포인트 로드
print(f"📦 ResGCN 모델 체크포인트 로드 중: {model_path}")
ckpt = torch.load(model_path, map_location=device)

# 체크포인트에서 모델 하이퍼파라미터 추출
if 'hp' in ckpt:
    hp = ckpt['hp']
    in_dim = 768  # all-mpnet-base-v2의 차원
    hidden = hp.get('hidden', 128)
    num_blocks = hp.get('layers', 2)
    dropout = hp.get('dropout', 0.1)
else:
    # 기본값 사용
    in_dim = 768
    hidden = 128
    num_blocks = 2
    dropout = 0.1
    print("⚠️  체크포인트에 hp 정보가 없어 기본값을 사용합니다.")

# state_dict 추출
if 'state_dict' in ckpt:
    state_dict = ckpt['state_dict']
else:
    state_dict = ckpt

# 출력 클래스 수는 체크포인트에서 확인
if 'head.weight' in state_dict:
    num_classes = state_dict['head.weight'].shape[0]
    print(f"📊 체크포인트에서 num_classes 확인: {num_classes}")
elif 'label_encoder_classes' in ckpt:
    num_classes = len(ckpt['label_encoder_classes'])
    print(f"📊 체크포인트에서 label_encoder_classes로 num_classes 확인: {num_classes}")
elif meta.get('classes'):
    num_classes = len(meta['classes'])
    print(f"📊 메타데이터에서 num_classes 확인: {num_classes}")
else:
    num_classes = 10  # 기본값
    print(f"⚠️  num_classes를 확인할 수 없어 기본값 사용: {num_classes}")

print(f"📊 모델 설정: in_dim={in_dim}, hidden={hidden}, num_classes={num_classes}, num_blocks={num_blocks}, dropout={dropout}")

# ResGCN 모델 인스턴스 생성
model = ResGCN(in_dim=in_dim, hidden=hidden, out_dim=num_classes, layers=num_blocks, dropout=dropout)

# state_dict 로드
model.load_state_dict(state_dict)
print("✅ 모델 state_dict 로드 완료")

model.to(device)
model.eval()
print(f"✅ ResGCN 모델 로드 완료 (device: {device})")

# Label Encoder 설정 (체크포인트 또는 메타데이터에서)
if 'label_encoder_classes' in ckpt:
    label_encoder_classes = ckpt['label_encoder_classes']
elif meta.get('classes'):
    label_encoder_classes = meta['classes']
else:
    # 기본 클래스 목록 (노트북에서 사용한 10개 클래스)
    label_encoder_classes = [
        "Activity Notifications",
        "Confirmshaming",
        "Countdown Timers",
        "High-demand Messages",
        "Limited-time Messages",
        "Low-stock Messages",
        "Not Dark Pattern",
        "Pressured Selling",
        "Testimonials of Uncertain Origin",
        "Trick Questions"
    ]
    print("⚠️  Label encoder 클래스를 확인할 수 없어 기본값 사용")

# LabelEncoder 생성 (예측 결과 디코딩용)
label_encoder = LabelEncoder()
label_encoder.classes_ = np.array(label_encoder_classes)
print(f"✅ Label Encoder 설정 완료: {len(label_encoder_classes)}개 클래스")

# Predicate -> Type 매핑 (사용자 제공 매핑)
PREDICATE_TO_TYPE_MAP = {
    # Urgency
    "Countdown Timers": "Urgency",
    "Limited-time Messages": "Urgency",
    # Misdirection
    "Confirmshaming": "Misdirection",
    "Trick Questions": "Misdirection",
    "Pressured Selling": "Misdirection",
    # Social Proof
    "Activity Notifications": "Social Proof",
    "Testimonials of Uncertain Origin": "Social Proof",
    # Scarcity
    "Low-stock Messages": "Scarcity",
    "High-demand Messages": "Scarcity",
    # Not Dark Pattern
    "Not Dark Pattern": "Not Dark Pattern",
}

def get_type_from_predicate(predicate):
    """
    Predicate 값으로부터 Type을 반환
    """
    if not predicate:
        return None
    # 직접 매핑 확인
    if predicate in PREDICATE_TO_TYPE_MAP:
        return PREDICATE_TO_TYPE_MAP[predicate]
    # 대소문자 무시 매칭
    predicate_lower = predicate.lower()
    for key, value in PREDICATE_TO_TYPE_MAP.items():
        if key.lower() == predicate_lower:
            return value
    return None

# 텍스트 블록 파싱 유틸리티
def parse_text_blocks(raw_text):
    """
    '#'(블록) 및 '*'(단어) 구분자를 사용하는 문자열을 자연어 문장 리스트로 변환
    기존 포맷(*만 사용)도 자동으로 처리
    """
    if raw_text is None:
        return []

    if isinstance(raw_text, list):
        candidates = raw_text
    else:
        text = str(raw_text)
        if "#" in text:
            candidates = [seg.strip() for seg in text.split("#") if seg.strip()]
        else:
            candidates = [seg.strip() for seg in text.split("*") if seg.strip()]

    cleaned = []
    for segment in candidates:
        if segment is None:
            continue
        segment_str = str(segment)
        segment_str = segment_str.replace("*", " ")
        segment_str = re.sub(r"\s+", " ", segment_str).strip()
        if segment_str:
            cleaned.append(segment_str)
    return cleaned

# kNN 그래프 구성 함수 (노트북 구조)
def knn_indices(emb, k=10, metric="cosine"):
    """kNN 인덱스 계산"""
    nn = NearestNeighbors(n_neighbors=k+1, metric=metric)
    nn.fit(emb)
    _, idx = nn.kneighbors(emb)
    return idx[:, 1:]  # drop self

def build_edge_index(neigh_idx: np.ndarray, mutual: bool):
    """엣지 인덱스 구성 (노트북 구조)"""
    N, k = neigh_idx.shape
    rows = np.repeat(np.arange(N), k)
    cols = neigh_idx.reshape(-1)
    # mutual/non-mutual 대칭 처리
    if not mutual:
        ei = np.vstack([np.concatenate([rows, cols]),
                        np.concatenate([cols, rows])])
        return np.unique(ei, axis=1)
    # mutual kNN
    S = set(zip(rows.tolist(), cols.tolist()))
    mutual_pairs = [(i, j) for (i, j) in S if (j, i) in S and i != j]
    if len(mutual_pairs) == 0:
        ei = np.vstack([np.concatenate([rows, cols]),
                        np.concatenate([cols, rows])])
        return np.unique(ei, axis=1)
    r = np.array([p[0] for p in mutual_pairs])
    c = np.array([p[1] for p in mutual_pairs])
    ei = np.vstack([np.concatenate([r, c]),
                    np.concatenate([c, r])])
    return np.unique(ei, axis=1)

def forward_on_concat(model, X_train: np.ndarray, X_query: np.ndarray):
    """
    Inductive inference: train + query 임베딩을 concat하여 kNN 그래프 구성 후 추론
    노트북의 forward_on_concat 방식과 동일
    """
    if X_train is None or len(X_train) == 0:
        # Train embeddings가 없으면 단일 노드 그래프로 추론 (비권장)
        print("⚠️  Train embeddings가 없어 단일 노드 그래프로 추론합니다.")
        X_cat = X_query
        # 단일 노드 그래프 (엣지 없음)
        edge_index = np.empty((2, 0), dtype=np.int64)
    else:
        # Train + Query concat
        X_cat = np.vstack([X_train, X_query])
        # kNN 그래프 구성
        knn_k = meta.get('knn_k', 10)
        metric = meta.get('metric', 'cosine')
        mutual_knn = meta.get('mutual_knn', True)
        
        knn = knn_indices(X_cat, k=knn_k, metric=metric)
        edge_index = build_edge_index(knn, mutual_knn)
    
    # PyG Data 객체 생성
    data = Data(
        x=torch.tensor(X_cat, dtype=torch.float32, device=device),
        edge_index=torch.tensor(edge_index, dtype=torch.long, device=device),
    )
    
    # 추론
    model.eval()
    with torch.no_grad():
        logits = model(data)  # [total_nodes, num_classes]
        probs = F.softmax(logits, dim=1).detach().cpu().numpy()
    
    # Query 부분만 반환
    if X_train is not None and len(X_train) > 0:
        return probs[len(X_train):]
    else:
        return probs

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

        # ResGCN 모델로 직접 예측 (1-2단계 구분 없이)
        category, predicate, top_preds = None, None, []
        is_dark = 0
        probability = None

        try:
            # SentenceTransformer로 임베딩 생성
            with torch.no_grad():
                embedding = st_model.encode([translated_text], convert_to_numpy=True, show_progress_bar=False)  # [1, 768]
            
            # Inductive inference: forward_on_concat 사용
            query_probs = forward_on_concat(model, X_train, embedding)  # [1, num_classes]
            
            # 결과 후처리
            pred_probs = query_probs[0]  # [num_classes]
            pred_idx = np.argmax(pred_probs)
            
            # Predicate 디코딩
            predicate = label_encoder.inverse_transform([pred_idx])[0]
            probability = float(pred_probs[pred_idx])
            
            # 다크패턴 여부 판단: predicate가 "Not Dark Pattern"이 아니면 다크패턴
            is_not_dark_keywords = ["not dark pattern", "not_dark_pattern", "not dark", "normal", "none"]
            is_dark = 1 if not any(keyword in predicate.lower() for keyword in is_not_dark_keywords) else 0
            
            # Top 3 predictions
            top_indices = pred_probs.argsort()[::-1][:3]
            top_preds = [
                f"{label_encoder.inverse_transform([i])[0]} ({round(pred_probs[i], 4)})"
                for i in top_indices
            ]
            
            # Category는 predicate로부터 매핑 (우선: 직접 매핑, 없으면 CSV에서 찾기)
            if predicate:
                # 직접 매핑 사용 (사용자 제공 매핑)
                category = get_type_from_predicate(predicate)
                # CSV에서 찾기 (fallback)
                if not category:
                    category_row = reduced_law[reduced_law["predicate"] == predicate]
                    if not category_row.empty:
                        category = category_row.iloc[0]["type"]
                # 둘 다 없으면 None 유지
        except Exception as e:
            print(f"[WARNING] ResGCN 예측 실패: {e}")
            import traceback
            traceback.print_exc()
            predicate = None
            top_preds = []
            category = None
            probability = None
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
    fullText를 블록 단위로 분리하여 각 텍스트에 대해 모델 예측 수행
    (신규 포맷: '#' 구분, 기존 포맷: '*' 구분)
    
    Args:
        full_text: 수집된 텍스트 (문자열 또는 문자열 리스트)
        
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
    
    # 텍스트 블록 파싱
    text_list = parse_text_blocks(full_text)
    print(f"📊 [텍스트 분리] 총 {len(text_list)}개 블록 처리 예정")
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
        
        # ResGCN 모델로 직접 예측 (노트북 구조: inductive inference)
        print(f"     📊 ResGCN 모델 예측 중 (입력: {len(translated_text)}자)")
        sys.stdout.flush()
        
        try:
            # SentenceTransformer로 임베딩 생성
            with torch.no_grad():
                embedding = st_model.encode([translated_text], convert_to_numpy=True, show_progress_bar=False)  # [1, 768]
            
            # Inductive inference: forward_on_concat 사용 (노트북 방식)
            query_probs = forward_on_concat(model, X_train, embedding)  # [1, num_classes]
            
            # 결과 후처리
            pred_probs = query_probs[0]  # [num_classes]
            pred_idx = np.argmax(pred_probs)
            
            # Predicate 디코딩
            predicate = label_encoder.inverse_transform([pred_idx])[0]
            probability = float(pred_probs[pred_idx])
            
            # 다크패턴 여부 판단: predicate가 "Not Dark Pattern"이 아니면 다크패턴
            is_not_dark_keywords = ["not dark pattern", "not_dark_pattern", "not dark", "normal", "none"]
            is_dark = 1 if not any(keyword in predicate.lower() for keyword in is_not_dark_keywords) else 0
            
            # Top 3 predictions
            top_indices = pred_probs.argsort()[::-1][:3]
            top_preds = [
                f"{label_encoder.inverse_transform([i])[0]} ({round(pred_probs[i], 4)})"
                for i in top_indices
            ]
            
            # Category는 predicate로부터 매핑 (우선: 직접 매핑, 없으면 CSV에서 찾기)
            if predicate:
                # 직접 매핑 사용 (사용자 제공 매핑)
                category = get_type_from_predicate(predicate)
                # CSV에서 찾기 (fallback)
                if not category:
                    category_row = reduced_law[reduced_law["predicate"] == predicate]
                    if not category_row.empty:
                        category = category_row.iloc[0]["type"]
                # 둘 다 없으면 None 유지
            
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