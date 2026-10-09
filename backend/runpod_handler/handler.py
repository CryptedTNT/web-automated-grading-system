"""TrOCR worker: base64 crop in, recognized text and confidence out."""
from __future__ import annotations

import base64
import io
import os
import sys
import traceback

print("[startup] Python running; importing RunPod", flush=True)
import runpod
print("[startup] importing torch", flush=True)
import torch
from PIL import Image
print(f"[startup] torch={torch.__version__}; importing transformers", flush=True)
from transformers import AutoProcessor, VisionEncoderDecoderModel

MODEL_DIR = os.environ.get("HTR_MODEL_DIR", "/model")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
BEAM_WIDTH = 4
GREEDY_CONFIDENCE_FLOOR = 0.9

# RunPod mounts an attached Network Volume at this fixed path. Without
# a cache_dir pointed there, snapshot_download() below writes to the
# ephemeral container filesystem, so a brand-new container (every cold
# start, since workers scale to zero) re-downloads the whole model from
# HF Hub -- the dominant chunk of this worker's cold-start time. Once a
# volume is attached to the endpoint, the first cold start populates
# this cache and every later one reuses it; with no volume attached
# this stays None and behaves exactly as before (HF's own default
# cache, no change in behavior).
_NETWORK_VOLUME = "/runpod-volume"
_HF_CACHE_DIR = None
if os.path.isdir(_NETWORK_VOLUME):
    _HF_CACHE_DIR = os.path.join(_NETWORK_VOLUME, "hf_cache")
    os.makedirs(_HF_CACHE_DIR, exist_ok=True)
    print(f"[startup] network volume found; caching model at {_HF_CACHE_DIR}", flush=True)

try:
    model_repo = os.environ.get("HTR_MODEL_REPO", "").strip()
    if model_repo:
        from huggingface_hub import snapshot_download
        if not os.environ.get("HF_TOKEN"):
            raise RuntimeError("Set HF_TOKEN using a RunPod Secret to access the private model")
        print("[startup] fetching private model snapshot (cached after the first cold start if a volume is attached)", flush=True)
        MODEL_DIR = snapshot_download(
            repo_id=model_repo,
            revision=os.environ.get("HTR_MODEL_REVISION", "main"),
            token=os.environ["HF_TOKEN"],
            allow_patterns=["*.json", "*.safetensors"],
            cache_dir=_HF_CACHE_DIR,
        )
    print(f"[startup] loading processor from {MODEL_DIR}", flush=True)
    _processor = AutoProcessor.from_pretrained(MODEL_DIR, local_files_only=True)
    print(f"[startup] loading model onto {DEVICE}", flush=True)
    _model = VisionEncoderDecoderModel.from_pretrained(
        MODEL_DIR, local_files_only=True
    ).to(DEVICE)
    _model.eval()
    print("[startup] TrOCR ready", flush=True)
except Exception:
    traceback.print_exc(file=sys.stdout)
    sys.stdout.flush()
    raise


def _decode(pixel_values: torch.Tensor, num_beams: int) -> tuple[str, float]:
    with torch.inference_mode():
        output = _model.generate(
            pixel_values, max_length=64, num_beams=num_beams,
            output_scores=True, return_dict_in_generate=True,
        )
    text = _processor.batch_decode(output.sequences, skip_special_tokens=True)[0].strip()
    beam_scores = getattr(output, "sequences_scores", None)
    if beam_scores is not None:
        return text, float(torch.exp(beam_scores[0]).clamp(0, 1))
    steps = _model.compute_transition_scores(
        output.sequences, output.scores, normalize_logits=True
    )[0]
    generated = output.sequences[0, -steps.shape[0]:]
    keep = generated != _model.generation_config.pad_token_id
    count = max(1, int(keep.sum()))
    return text, float(torch.exp(steps[keep].sum() / count).clamp(0, 1))


def handler(job):
    job_input = job.get("input")
    if not isinstance(job_input, dict) or not isinstance(job_input.get("image_base64"), str):
        return {"error": "input.image_base64 must contain a base64-encoded PNG or JPEG"}
    try:
        image_bytes = base64.b64decode(job_input["image_base64"], validate=True)
        with Image.open(io.BytesIO(image_bytes)) as image:
            crop = image.convert("RGB")
    except (ValueError, OSError):
        return {"error": "image_base64 is not a valid base64-encoded image"}
    pixel_values = _processor(images=crop, return_tensors="pt").pixel_values.to(DEVICE)
    text, confidence = _decode(pixel_values, num_beams=1)
    if confidence < GREEDY_CONFIDENCE_FLOOR:
        text, confidence = _decode(pixel_values, num_beams=BEAM_WIDTH)
    return {"text": text, "confidence": confidence}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
