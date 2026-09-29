"""TrOCR wrapper -- recognizes handwritten text from a cropped answer
region. The model is a fine-tuned TrOCR-base-sized checkpoint (encoder
hidden_size 768, decoder d_model 1024 -- see models/htr/config.json),
saved at backend/models/htr/ as config + tokenizer + model.safetensors.
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


def recognize_text(crop: Image.Image) -> tuple[str, float]:
    """Returns (recognized_text, confidence) for one cropped answer
    region. confidence is derived from the decoder's own sequence
    score (exp of the length-normalized log-probability), 0-1 -- TrOCR's
    generate() doesn't give a single clean per-string confidence the
    way a classifier would, so this is the closest available proxy.
    """
    processor, _ = _load()
    pixel_values = processor(images=crop.convert("RGB"), return_tensors="pt").pixel_values.to(_DEVICE)

    text, confidence = _decode(pixel_values, num_beams=1)
    if confidence >= GREEDY_CONFIDENCE_FLOOR:
        return text, confidence
    return _decode(pixel_values, num_beams=BEAM_WIDTH)
