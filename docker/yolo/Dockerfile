# 本地边缘 YOLO 推理服务（防OOM：CPU推理 / 限线程 / 单worker / 限图片尺寸）
FROM python:3.11-slim

WORKDIR /app

# opencv 运行依赖（libGL/libglib）
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# 先装 CPU 版 PyTorch + 版本匹配的 torchvision（避免 torchvision::nms 算子不匹配），再装业务依赖
RUN pip install --no-cache-dir torch==2.4.1 torchvision==0.19.1 \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple \
    fastapi==0.115.* uvicorn==0.30.* ultralytics==8.2.103 opencv-python-headless==4.10.* numpy==1.26.* rapidocr_onnxruntime

COPY yolo_service.py /app/yolo_service.py
COPY yolov8n.pt /app/yolov8n.pt

# 防OOM三件套：OMP线程数=2 / glibc arena=2 / 单worker
ENV OMP_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    MALLOC_ARENA_MAX=2 \
    PYTORCH_ENABLE_MPS_FALLBACK=0 \
    PYTHONUNBUFFERED=1

# 健康检查
HEALTHCHECK --interval=60s --timeout=5s --retries=10 --start-period=90s \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8999/health',timeout=3)" || exit 1

EXPOSE 8999
# 单 worker，限并发，CPU 推理
CMD ["python", "yolo_service.py"]
