# Built with the REPO ROOT as context (RunPod's GitHub-build integration
# always builds from the repo root, not from backend/), so every COPY
# below starts with "backend/". For a manual local build, run this from
# the repo root (not from inside backend/):
#   docker build -f backend/runpod_handler/Dockerfile -t <you>/ags-trocr-runpod:latest .
#   docker push <you>/ags-trocr-runpod:latest
#
# Model weights are baked into the image (not a RunPod network volume) so
# a cold start never pays for a download -- see recognizer.py's RunPod
# notes on why that matters for a small prepaid balance.

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

COPY backend/models/htr /model
COPY backend/runpod_handler/handler.py .

CMD ["python3", "handler.py"]
