"""RunPod Serverless handler for the TrOCR recognizer.

Mirrors app/inference/recognizer.py exactly (greedy decode first, beam
search of width 4 only when confidence < 0.9) so swapping USE_RUNPOD on
in the backend changes WHERE this runs, not WHAT it computes.

Job input:  {"input": {"image_base64": "<png/jpeg bytes, base64>"}}
Job output: {"text": "...", "confidence": 0.0-1.0}
"""

from __future__ import annotations

import base64
import io
import sys
import time
import traceback

import runpod
import torch
from PIL import Image
from transformers import AutoProcessor, VisionEncoderDecoderModel

MODEL_DIR = "/model"  # baked into the image by the Dockerfile
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

BEAM_WIDTH = 4
GREEDY_CONFIDENCE_FLOOR = 0.9

# DIAGNOSTIC: startup used to crash with no visible traceback (the worker
# exits before RunPod's log viewer can display anything). Catch any
# startup failure here, print it in full, and then hang instead of
# exiting -- a worker stuck in this loop stays "running" long enough for
# the Logs tab to actually show what happened. Remove this try/except
# (restore the two bare lines) once the real error is found and fixed.
try:
    print(f"[startup] torch={torch.__version__} cuda_available={torch.cuda.is_available()} device={DEVICE}", flush=True)
    if torch.cuda.is_available():
        print(f"[startup] cuda device name: {torch.cuda.get_device_name(0)}", flush=True)
    print("[startup] loading processor...", flush=True)
    _processor = AutoProcessor.from_pretrained(MODEL_DIR)
    print("[startup] processor OK, loading model...", flush=True)
    _model = VisionEncoderDecoderModel.from_pretrained(MODEL_DIR).to(DEVICE)
    _model.eval()
    print("[startup] model OK, starting worker.", flush=True)
except Exception:
    print("[startup] FAILED -- full traceback below:", flush=True)
    traceback.print_exc(file=sys.stdout)
    sys.stdout.flush()
    print("[startup] sleeping 5 min so this log stays visible -- check RunPod Logs tab now, "
          "then delete this worker from the Workers tab instead of waiting out the sleep.", flush=True)
    time.sleep(300)
    raise


def _decode(pixel_values: torch.Tensor, num_beams: int) -> tuple[str, float]:
    with torch.inference_mode():
        output = _model.generate(
            pixel_values,
            max_length=64,
            num_beams=num_beams,
            output_scores=True,
            return_dict_in_generate=True,
        )
    text = _processor.batch_decode(output.sequences, skip_special_tokens=True)[0].strip()
    beam_scores = getattr(output, "sequences_scores", None)
    if beam_scores is not None:
        return text, float(torch.exp(beam_scores[0]).clamp(0, 1))
    steps = _model.compute_transition_scores(output.sequences, output.scores, normalize_logits=True)[0]
    generated = output.sequences[0, -steps.shape[0]:]
    keep = generated != _model.generation_config.pad_token_id
    count = max(1, int(keep.sum()))
    return text, float(torch.exp(steps[keep].sum() / count).clamp(0, 1))


def handler(job):
    job_input = job["input"]
    image_bytes = base64.b64decode(job_input["image_base64"])
    crop = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    pixel_values = _processor(images=crop, return_tensors="pt").pixel_values.to(DEVICE)

    text, confidence = _decode(pixel_values, num_beams=1)
    if confidence < GREEDY_CONFIDENCE_FLOOR:
        text, confidence = _decode(pixel_values, num_beams=BEAM_WIDTH)

    return {"text": text, "confidence": confidence}


runpod.serverless.start({"handler": handler})
