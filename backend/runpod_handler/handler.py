"""TEMPORARY minimal test handler -- no torch/transformers at all.

Purpose: isolate whether RunPod can run ANY Python/runpod-sdk code on
this image, before suspecting torch/CUDA specifically. The real
handler is backed up; restore it once this test tells us something.
"""

print("[minimal-test] stage 0: python is running", flush=True)

import runpod
print("[minimal-test] stage 1: runpod import OK", flush=True)


def handler(job):
    print("[minimal-test] handler() called", flush=True)
    return {"text": "MINIMAL TEST OK", "confidence": 1.0}


print("[minimal-test] stage 2: about to call runpod.serverless.start()", flush=True)
runpod.serverless.start({"handler": handler})
