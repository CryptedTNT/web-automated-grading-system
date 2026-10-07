"""RunPod Serverless handler for the TrOCR recognizer.

Mirrors app/inference/recognizer.py exactly (greedy decode first, beam
search of width 4 only when confidence < 0.9) so swapping USE_RUNPOD on
in the backend changes WHERE this runs, not WHAT it computes.

Job input:  {"input": {"image_base64": "<png/jpeg bytes, base64>"}}
Job output: {"text": "...", "confidence": 0.0-1.0}
"""

from __future__ import annotations

import sys

# DIAGNOSTIC: every crash so far has shown nothing but a bare "exited with
# exit code 1" -- no Python traceback at all, even with a try/except around
# model loading. That means it is dying before any of our code runs, most
# likely a native-level crash (e.g. a CUDA/driver mismatch) during one of
# the imports below, which a Python except block can never catch. Printing
# and flushing a marker before each import lets us see the LAST stage that
# completed, even if the next line kills the process outright.
print("[startup] stage 0: python is running", flush=True)

import base64  # noqa: E402
print("[startup] stage 1: base64 OK", flush=True)
import io  # noqa: E402
print("[startup] stage 2: io OK", flush=True)
import time  # noqa: E402
print("[startup] stage 3: time OK", flush=True)
import traceback  # noqa: E402
print("[startup] stage 4: traceback OK", flush=True)

import runpod  # noqa: E402
print("[startup] stage 5: runpod import OK", flush=True)

import torch  # noqa: E402
print(f"[startup] stage 6: torch import OK, version={torch.__version__}", flush=True)

print("[startup] stage 7: checking torch.cuda.is_available()...", flush=True)
_cuda_ok = torch.cuda.is_available()
print(f"[startup] stage 8: torch.cuda.is_available() = {_cuda_ok}", flush=True)

if _cuda_ok:
    print("[startup] stage 9: querying GPU device name...", flush=True)
    print(f"[startup] stage 10: cuda device name: {torch.cuda.get_device_name(0)}", flush=True)

from PIL import Image  # noqa: E402
print("[startup] stage 11: PIL import OK", flush=True)

from transformers import AutoProcessor, VisionEncoderDecoderModel  # noqa: E402
print("[startup] stage 12: transformers import OK", flush=True)

MODEL_DIR = "/model"  # baked into the image by the Dockerfile
DEVICE = "cuda" if _cuda_ok else "cpu"

BEAM_WIDTH = 4
GREEDY_CONFIDENCE_FLOOR = 0.9

# Remove this whole try/except (restore the two bare loading lines) once
# the real crash point is found and fixed.
try:
    print("[startup] stage 13: loading processor...", flush=True)
    _processor = AutoProcessor.from_pretrained(MODEL_DIR)
    print("[startup] stage 14: processor OK, loading model onto CPU first...", flush=True)
    _model = VisionEncoderDecoderModel.from_pretrained(MODEL_DIR)
    print(f"[startup] stage 15: model loaded on CPU OK, moving to {DEVICE}...", flush=True)
    _model = _model.to(DEVICE)
    print("[startup] stage 16: model.to(device) OK, calling .eval()...", flush=True)
    _model.eval()
    print("[startup] stage 17: ALL STARTUP STAGES PASSED -- starting worker.", flush=True)
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
