# Backend Setup

Assumes `database/` is already set up and running (see `database/SETUP.md`)
and you have its `ags_app` password.

## 1. Python environment

```
cd backend
python -m venv venv
venv\Scripts\Activate.ps1        # or venv/Scripts/activate in Git Bash
```

## 2. Install dependencies

**Install PyTorch first, separately, with the CUDA index URL** -- if you skip
this and go straight to `pip install -r requirements.txt`, pip will still
install *a* torch (ultralytics and transformers both depend on it), but a
CPU-only build pulled in transitively, which works but is far slower for
inference. Check `nvidia-smi` first to confirm you have an NVIDIA GPU and
driver; if not, skip this step and just run `pip install -r requirements.txt`
directly (CPU-only is fine, just slower per sheet).

```
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements.txt
```

Verify CUDA is actually being used:

```
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

## 3. Model weights

Two trained models are expected on disk, **not committed to git** (see
`.gitignore` -- they're large binaries, hand them off separately):

```
backend/models/yolo/best.pt      YOLOv11 segmentation weights
backend/models/htr/              TrOCR model directory: config.json,
                                  generation_config.json, processor_config.json,
                                  tokenizer.json, tokenizer_config.json,
                                  model.safetensors
```

The YOLO model's class list (`app/inference/detector.py`'s
`CLASS_TO_QUESTION_TYPE`/`HEADER_FIELD_CLASSES`) assumes these exact class
names -- if you retrain with a different label set, check
`YOLO('models/yolo/best.pt').names` and update that mapping.

## 4. `.env`

```
cp .env.example .env
```

Fill in `DATABASE_URL` with the real `ags_app` password (URL-encode any
special characters -- e.g. `*` becomes `%2A`), and generate a real
`SECRET_KEY`:

```
python -c "import secrets; print(secrets.token_hex(32))"
```

## 5. Run

```
uvicorn app.main:app --reload --port 8000
```

Check `http://localhost:8000/api/health` returns `{"status":"ok"}`.

## Notes on the inference pipeline

- `app/inference/detector.py`, `recognizer.py`, `grading.py`, `pipeline.py` --
  see their docstrings for how YOLO detections are matched to specific
  `answer_key_item` rows and how Enumeration grading works. `grading.py`'s
  `match_enumeration_answers()` is a Python port of the same-named function in
  `vue-app/src/services/grading.js` -- keep the two in sync if the algorithm
  changes.
- Model loading is lazy and cached per-process (`get_detector()` /
  `recognizer._load()`) -- the first upload after a server restart pays the
  weight-loading cost, every one after that doesn't.
- Inference runs via `asyncio.to_thread()` inside `POST /api/sessions/<id>/sheets`
  so it doesn't block the event loop for other requests while a sheet is being
  processed.
- A per-sheet model failure marks that sheet `processing_status='error'` with
  the exception message in `error_message`, rather than failing the whole
  upload batch -- see `routers/sessions.py`.
