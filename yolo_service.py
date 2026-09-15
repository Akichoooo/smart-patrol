import io
import time
import base64
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from ultralytics import YOLO

app = FastAPI(title="Local Edge YOLO Inference Service")

# 允许跨域请求 (让前端 9080 端口能够直接调用 8999)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import os
print("[YOLO Service] 加载本地 YOLOv8 模型...")
MODELS_DIR = os.environ.get("YOLO_MODELS_DIR", "/app/models")
os.makedirs(MODELS_DIR, exist_ok=True)
DEFAULT_MODEL = "yolov8n.pt"
_model_cache = {"yolov8n.pt": YOLO(DEFAULT_MODEL)}
print("[YOLO Service] YOLOv8 模型加载就绪！")

def get_model(name):
    """按文件名取模型（带缓存）；支持上传到 /app/models 的自定义权重"""
    if not name:
        return _model_cache[DEFAULT_MODEL]
    name = os.path.basename(name)
    if name not in _model_cache:
        path = name if os.path.sep not in name and os.path.exists(os.path.join(MODELS_DIR, name)) else name
        full = os.path.join(MODELS_DIR, name)
        if os.path.exists(full):
            path = full
        print(f"[YOLO Service] 加载模型: {path}")
        _model_cache[name] = YOLO(path)
    return _model_cache[name]

# 防OOM：限制 PyTorch 线程数（与 OMP_NUM_THREADS=2 配合）
import torch
torch.set_num_threads(2)

# 入参图片最长边上限（超过先等比缩放，防止内存/计算爆炸）
MAX_SIDE = 1920
# 请求体积上限（base64 长度 ~ 10MB）
MAX_BODY = 14 * 1024 * 1024

@app.get("/")
@app.get("/health")
def health_check():
    return {
        "status": "online",
        "engine": "Ultralytics YOLOv8",
        "model": "yolov8n.pt",
        "threads": torch.get_num_threads(),
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
    }

print("[YOLO Service] 加载本地 OCR 引擎 (RapidOCR)...")
try:
    from rapidocr_onnxruntime import RapidOCR
    _ocr_engine = RapidOCR()
    print("[YOLO Service] RapidOCR 引擎加载就绪！")
except Exception as e:
    _ocr_engine = None
    print(f"[YOLO Service] RapidOCR 引擎未加载或加载失败 ({e})，将回退至 YOLO")

@app.api_route("/v1/ocr_detect", methods=["GET", "POST"])
async def ocr_detect(request: Request):
    if request.method == "GET":
        return {
            "code": 0,
            "status": "ready",
            "message": "本地边缘 OCR 检测接口正常运行中",
            "engine": "RapidOCR" if _ocr_engine is not None else "fallback-YOLO"
        }

    t0 = time.time()
    try:
        body = await request.json()
        image_data = body.get("image", "")
        conf_threshold = float(body.get("conf", 0.3))

        if not image_data:
            return JSONResponse(status_code=400, content={"code": 400, "message": "缺少 image 参数 (base64 编码)"})

        if len(image_data) > MAX_BODY:
            return JSONResponse(status_code=413, content={"code": 413, "message": "图片体积超限"})

        if "base64," in image_data:
            image_data = image_data.split("base64,")[1]

        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        w, h = image.size
        if max(w, h) > MAX_SIDE:
            scale = MAX_SIDE / max(w, h)
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        detections = []
        if _ocr_engine is not None:
            import numpy as np
            img_np = np.array(image)
            ocr_result, _ = _ocr_engine(img_np)
            if ocr_result:
                for item in ocr_result:
                    # item: [box, text, score]
                    pts, text, score = item[0], item[1], float(item[2])
                    if score < conf_threshold:
                        continue
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    box_xyxy = [min(xs), min(ys), max(xs), max(ys)]
                    detections.append({
                        "label": text,
                        "confidence": round(score, 4),
                        "box": [round(float(x), 1) for x in box_xyxy],
                        "class_id": 0
                    })
        else:
            model = get_model(body.get("model"))
            results = model.predict(image, conf=conf_threshold, verbose=False)
            for r in results:
                for box in r.boxes:
                    xyxy = box.xyxy[0].tolist()
                    conf = float(box.conf[0].item())
                    cls_id = int(box.cls[0])
                    label = model.names.get(cls_id, f"class_{cls_id}")
                    detections.append({
                        "label": label,
                        "confidence": round(conf, 4),
                        "box": [round(x, 1) for x in xyxy],
                        "class_id": cls_id
                    })

        cost_ms = round((time.time() - t0) * 1000, 2)
        return {
            "code": 0,
            "engine": "RapidOCR" if _ocr_engine is not None else "fallback-YOLO",
            "detections": detections,
            "count": len(detections),
            "inference_time_ms": cost_ms
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"code": 500, "error": str(e)})

@app.api_route("/v1/detect", methods=["GET", "POST"])
async def detect(request: Request):
    if request.method == "GET":
        return {
            "code": 0,
            "status": "ready",
            "message": "本地边缘 YOLO 检测接口正常运行中",
            "model": "yolov8n.pt"
        }

    t0 = time.time()
    try:
        body = await request.json()
        image_data = body.get("image", "")
        conf_threshold = float(body.get("conf", 0.5))
        model = get_model(body.get("model"))

        if not image_data:
            return JSONResponse(status_code=400, content={"code": 400, "message": "缺少 image 参数 (base64 编码)"})

        # 请求体积限制
        if len(image_data) > MAX_BODY:
            return JSONResponse(status_code=413, content={"code": 413, "message": "图片体积超限"})

        if "base64," in image_data:
            image_data = image_data.split("base64,")[1]

        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # 最长边限制：超过先等比缩放（防 OOM）
        w, h = image.size
        if max(w, h) > MAX_SIDE:
            scale = MAX_SIDE / max(w, h)
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        # 执行推理（CPU）
        results = model.predict(image, conf=conf_threshold, verbose=False)

        detections = []
        for r in results:
            for box in r.boxes:
                xyxy = box.xyxy[0].tolist()
                conf = float(box.conf[0].item())
                cls_id = int(box.cls[0])
                label = model.names.get(cls_id, f"class_{cls_id}")
                detections.append({
                    "label": label,
                    "confidence": round(conf, 4),
                    "box": [round(x, 1) for x in xyxy],
                    "class_id": cls_id
                })

        cost_ms = round((time.time() - t0) * 1000, 2)
        return {
            "code": 0,
            "model": body.get("model") or DEFAULT_MODEL,
            "detections": detections,
            "count": len(detections),
            "inference_time_ms": cost_ms
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"code": 500, "error": str(e)})

if __name__ == "__main__":
    import uvicorn
    print("[YOLO Service] 正在启动本地边缘推理服务，监听 0.0.0.0:8999 ...")
    # 单 worker（防OOM），限线程已由 torch.set_num_threads 控制
    uvicorn.run(app, host="0.0.0.0", port=8999, log_level="info", workers=1)
