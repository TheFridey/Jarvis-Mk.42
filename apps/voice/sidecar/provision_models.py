"""Explicit operator-run model download. Never imported by the offline runtime."""
import argparse
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--asr-model", default="Systran/faster-whisper-base.en")
parser.add_argument("--voice", default="bf_emma")
args = parser.parse_args()
destination = Path(args.directory).resolve()
os.environ["HF_HOME"] = str(destination / "hf")
from huggingface_hub import snapshot_download
snapshot_download(repo_id=args.asr_model, local_dir=str(destination / "asr"))
from kokoro import KPipeline
pipeline = KPipeline(lang_code="b")
# Populate the selected voice/G2P cache without playback or audio persistence.
for _ in pipeline("Voice assets ready.", voice=args.voice):
    pass
print("Local voice assets provisioned. Set HF_HOME and JARVIS_ASR_MODEL_PATH to these directories.")
