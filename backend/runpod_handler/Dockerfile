# Built with the REPO ROOT as context (RunPod's GitHub-build integration
# always builds from the repo root, not from backend/), so every COPY
# below starts with "backend/". For a manual local build, run this from
# the repo root (not from inside backend/):
#   docker build -f backend/runpod_handler/Dockerfile -t <you>/ags-trocr-runpod:latest .
#   docker push <you>/ags-trocr-runpod:latest
#
# Private model weights are downloaded at worker startup using HTR_MODEL_REPO
# and the HF_TOKEN runtime Secret. Never put the token in a build argument.

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3.11 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# A too-old pip can crash with an internal resolver AssertionError
# ("assert len(weights) == expected_node_count") on a large dependency
# tree -- upgrade it first so that bug doesn't resurface.
RUN pip install --no-cache-dir --upgrade pip

# torch must come from its own CUDA wheel index, matching the CUDA base
# image above, or pip will silently resolve a CPU-only build instead.
RUN pip install --no-cache-dir torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124

COPY backend/runpod_handler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYTHONUNBUFFERED=1 HF_HUB_DISABLE_PROGRESS_BARS=1
COPY backend/runpod_handler/handler.py .

CMD ["python3", "handler.py"]
