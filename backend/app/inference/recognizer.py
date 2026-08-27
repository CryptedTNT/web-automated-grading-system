"""TrOCR wrapper -- recognizes handwritten text from a cropped answer
region. The model is a small custom TrOCR architecture (not a fine-tune
of microsoft/trocr-base-handwritten -- see models/htr/config.json,
hidden_size 384 vs the base model's 768), saved at backend/models/htr/
as config + tokenizer + model.safetensors.
"""

from __future__ import annotations

from pathlib import Path

import torch
from PIL import Image
from transformers import AutoProcessor, VisionEncoderDecoderModel

_MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "models" / "htr"
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

MODEL_NAME = "TrOCR-custom (backend/models/htr)"

_processor: AutoProcessor | None = None
_model: VisionEncoderDecoderModel | None = None


def _load():
    """Loads the processor/model once per process -- loading a 235MB
    checkpoint per request would make every upload unusably slow."""
    global _processor, _model
    if _model is None:
        _processor = AutoProcessor.from_pretrained(str(_MODEL_DIR))
        _model = VisionEncoderDecoderModel.from_pretrained(str(_MODEL_DIR)).to(_DEVICE)
        _model.eval()
    return _processor, _model


def recognize_text(crop: Image.Image) -> tuple[str, float]:
    """Returns (recognized_text, confidence) for one cropped answer
    region. confidence is derived from the beam search's own sequence
    score (exp of the length-penalized log-probability), 0-1 -- TrOCR's
    generate() doesn't give a single clean per-string confidence the
    way a classifier would, so this is the closest available proxy.
    """
    processor, model = _load()
    pixel_values = processor(images=crop.convert("RGB"), return_tensors="pt").pixel_values.to(_DEVICE)

    with torch.no_grad():
        output = model.generate(
            pixel_values,
            max_length=64,
            num_beams=4,
            output_scores=True,
            return_dict_in_generate=True,
        )

    text = processor.batch_decode(output.sequences, skip_special_tokens=True)[0].strip()
    confidence = 0.0
    if output.sequences_scores is not None:
        confidence = float(torch.exp(output.sequences_scores[0]).clamp(0, 1))

    return text, confidence
