# TrOCR on RunPod Serverless

Offloads `recognize_text()` to a RunPod GPU worker instead of running it on
the Azure VM's CPU. Mirrors `app/inference/recognizer.py`'s logic exactly
(greedy decode first, beam search of width 4 only when confidence < 0.9).

## What's already built here
- `handler.py` -- the RunPod serverless function.
- `Dockerfile` -- bakes the model weights (`../models/htr`) into the image,
  so a cold start never pays for a download.
- `requirements.txt` -- the handler's own dependencies.
- `app/inference/recognizer.py` already has the `USE_RUNPOD` toggle wired in,
  with automatic fallback to local CPU inference on any RunPod failure.

## What you need to do (steps only you can do -- account + payment)

1. **Create a RunPod account** at runpod.io and add $15 of balance
   (Settings -> Billing). This is prepaid: you cannot be charged more than
   what you add.

2. **Build and push the Docker image** (needs Docker Desktop and a free
   Docker Hub account):
   ```
   cd backend
   docker build -f runpod_handler/Dockerfile -t <your-dockerhub-username>/ags-trocr-runpod:latest .
   docker login
   docker push <your-dockerhub-username>/ags-trocr-runpod:latest
   ```

3. **Create the Serverless endpoint** (RunPod console -> Serverless -> New Endpoint):
   - Container Image: `<your-dockerhub-username>/ags-trocr-runpod:latest`
   - GPU: pick the **cheapest tier** -- RTX A4000 / A4500 / RTX 4000 / RTX 2000
     class (~$0.00016/sec, ~$0.58/hr active). This model is small (333M
     params); it does not need anything bigger.
   - **Active (min) workers: 0** -- this is what makes it free while idle.
     Do not raise this "to avoid cold starts."
   - **Max workers: 1** -- hard caps concurrent spend; a burst of requests
     queues instead of spawning parallel paid workers.
   - **Execution timeout:** 60s (a single crop should never legitimately
     take longer; this stops a stuck request from burning the balance).
   - Leave network volume empty -- the model is already baked into the image.

4. **Copy the endpoint ID and an API key** (RunPod console -> Settings ->
   API Keys) into `backend/.env`:
   ```
   USE_RUNPOD=true
   RUNPOD_API_KEY=<your key>
   RUNPOD_ENDPOINT_ID=<your endpoint id>
   ```
   Restart the backend (`sudo systemctl restart ags-backend` on the VM, or
   just restart uvicorn locally) for the new env vars to take effect.

5. **Test with one real upload** before trusting it for a demo, and check
   RunPod's billing dashboard afterward to see the actual cost of that one
   request -- that tells you concretely how many more you can afford.

## Turning it off

Set `USE_RUNPOD=false` in `.env` and restart -- recognition instantly goes
back to local CPU inference, no RunPod calls at all. Do this between testing
sessions so the public site isn't spending your balance on ordinary traffic;
only flip it to `true` for the specific window you're actively using it.
