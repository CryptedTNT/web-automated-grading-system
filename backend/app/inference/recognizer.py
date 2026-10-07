"""TrOCR wrapper -- recognizes handwritten text from a cropped answer
region. The model is a fine-tuned TrOCR-base-sized checkpoint (encoder
hidden_size 768, decoder d_model 1024 -- see models/htr/config.json),
saved at backend/models/htr/ as config + tokenizer + model.safetensors.

RunPod Serverless offload (optional): set USE_RUNPOD=true plus
RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env to send recognition calls
to a GPU worker instead of running locally on CPU -- see
runpod_handler/ for the matching handler and Dockerfile. Any RunPod
failure (timeout, network error, FAILED status, empty balance) falls
back to the local path below rather than breaking a grading run; this
is deliberate so a drained prepaid balance degrades to "slow" (CPU),
never to "broken." Leave USE_RUNPOD unset/false on the public site by
default -- it is meant to be switched on only for a specific testing or
demo window, not left on for arbitrary public traffic, since every
request then spends real RunPod balance.
"""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from threading import RLock

import requests
import torch
from PIL import Image
from transformers import AutoProcessor, VisionEncoderDecoderModel

_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "htr"
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

MODEL_NAME = "TrOCR-custom (backend/models/htr)"

USE_RUNPOD = os.getenv("USE_RUNPOD", "false").lower() == "true"
_RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
_RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID", "")
_RUNPOD_TIMEOUT_S = float(os.getenv("RUNPOD_TIMEOUT_S", "30"))

_processor: AutoProcessor | None = None
_model: VisionEncoderDecoderModel | None = None
_local_lock = RLock()


def _load():
    """Loads the processor/model once per process -- loading a ~1.24GB
    checkpoint per request would make every upload unusably slow."""
    global _processor, _model
    if _model is None:
        _processor = AutoProcessor.from_pretrained(str(_MODEL_DIR))
        _model = VisionEncoderDecoderModel.from_pretrained(str(_MODEL_DIR)).to(_DEVICE)
        _model.eval()
    return _processor, _model


# Beam search (4 beams) was ~80% of the time to read one answer on a CPU-only server (measured: ~5.3 s per crop
# on 2 threads, of which the image encoder is only ~1 s); greedy decoding takes ~1.5 s and, on the 1,009-crop
# test split, matched beam search almost exactly (Grading Accuracy 0.9678 vs 0.9681). A crop is therefore read
# greedily first, and only re-read with beam search when the model is not confident in that first reading
# (about 6% of crops). With the floor at 0.9 the two-step result was identical to full beam search on that
# split (CER 0.1042, exact 0.8722), including the answers where greedy alone drops a word.
BEAM_WIDTH = 4
GREEDY_CONFIDENCE_FLOOR = 0.9


def _decode(pixel_values: torch.Tensor, num_beams: int) -> tuple[str, float]:
    """One decoding pass. confidence is exp of the length-normalised log-probability of the whole string
    (beam search: HF's own sequences_scores; greedy: the same quantity from the per-token scores), 0-1."""
    processor, model = _load()
    with torch.inference_mode():
        output = model.generate(
            pixel_values,
            max_length=64,
            num_beams=num_beams,
            output_scores=True,
            return_dict_in_generate=True,
        )
    text = processor.batch_decode(output.sequences, skip_special_tokens=True)[0].strip()
    beam_scores = getattr(output, "sequences_scores", None)  # only beam search returns it
    if beam_scores is not None:
        return text, float(torch.exp(beam_scores[0]).clamp(0, 1))
    steps = model.compute_transition_scores(output.sequences, output.scores, normalize_logits=True)[0]
    generated = output.sequences[0, -steps.shape[0]:]
    keep = generated != model.generation_config.pad_token_id
    count = max(1, int(keep.sum()))
    return text, float(torch.exp(steps[keep].sum() / count).clamp(0, 1))


def _recognize_via_runpod(crop: Image.Image) -> tuple[str, float] | None:
    """Returns (text, confidence) from the RunPod endpoint, or None on
    any failure so the caller falls back to local inference."""
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="PNG")
    image_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    url = f"https://api.runpod.ai/v2/{_RUNPOD_ENDPOINT_ID}/runsync"
    headers = {"Authorization": f"Bearer {_RUNPOD_API_KEY}"}
    payload = {"input": {"image_base64": image_b64}}

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=_RUNPOD_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "COMPLETED":
            return None
        output = data["output"]
        return output["text"], float(output["confidence"])
    except Exception:
        return None


def recognize_text(crop: Image.Image) -> tuple[str, float]:
    """Returns (recognized_text, confidence) for one cropped answer
    region. confidence is derived from the decoder's own sequence
    score (exp of the length-normalized log-probability), 0-1 -- TrOCR's
    generate() doesn't give a single clean per-string confidence the
    way a classifier would, so this is the closest available proxy.
    """
    if USE_RUNPOD:
        result = _recognize_via_runpod(crop)
        if result is not None:
            return result
        # Falls through to local CPU inference below on any RunPod failure.

    # Parallel remote requests may fail simultaneously. Serialize the local
    # fallback to avoid racing model initialization or exhausting CPU/GPU RAM.
    with _local_lock:
        processor, _ = _load()
        pixel_values = processor(images=crop.convert("RGB"), return_tensors="pt").pixel_values.to(_DEVICE)
        text, confidence = _decode(pixel_values, num_beams=1)
        if confidence >= GREEDY_CONFIDENCE_FLOOR:
            return text, confidence
        return _decode(pixel_values, num_beams=BEAM_WIDTH)
