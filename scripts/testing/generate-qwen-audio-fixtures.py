"""Generate independent NumPy FFT reference data for pinned Qwen log-Mel input.

The model's Slaney coefficients are data, not executable code. Formula follows
https://huggingface.co/Qwen/Qwen3-ASR-0.6B/blob/main/preprocessor_config.json
and the pinned browser export's prompt_config.json. No model inference is used.
"""
import base64
import hashlib
import json
from pathlib import Path
import numpy as np

root = Path(__file__).resolve().parents[2]
filters_file = root / 'tests/fixtures/qwen-asr/mel-filters.json'
filters = np.asarray(json.loads(filters_file.read_text())['data'], dtype=np.float64)
window = .5 - .5 * np.cos(2 * np.pi * np.arange(400) / 400)

def encode(array):
    return base64.b64encode(np.asarray(array, dtype='<f4').tobytes()).decode()

rng = np.random.default_rng(20261004)
impulse = np.zeros(1600, dtype=np.float32)
impulse[799] = .75
cases = {
    'silence': np.zeros(4800, dtype=np.float32),
    'impulse': impulse,
    'sine440': (.3 * np.sin(2 * np.pi * 440 * np.arange(2000) / 16000)).astype(np.float32),
    'chirp': (.2 * np.sin(2 * np.pi * (220 * np.arange(3217) / 16000 + 1200 * (np.arange(3217) / 16000) ** 2))).astype(np.float32),
    'seeded-noise': rng.uniform(-.2, .2, 1703).astype(np.float32),
    'short-boundary': rng.uniform(-.1, .1, 401).astype(np.float32),
}
results = []
for name, audio in cases.items():
    padded = np.pad(audio.astype(np.float64), (200, 200), mode='reflect')
    frames = len(audio) // 160
    framed = np.stack([padded[i * 160:i * 160 + 400] * window for i in range(frames)])
    power = np.abs(np.fft.rfft(framed, n=400, axis=1)) ** 2
    mel = np.log10(np.maximum(filters @ power.T, 1e-10)).astype(np.float32)
    mel = (np.maximum(mel, np.max(mel) - 8) + 4) / 4
    results.append({'name': name, 'samples': len(audio), 'frames': frames, 'audioF32Base64': encode(audio), 'melF32Base64': encode(mel)})
output = {'numpy': np.__version__, 'filtersSha256': hashlib.sha256(filters_file.read_bytes()).hexdigest(), 'atol': 2e-5, 'cases': results}
(root / 'tests/fixtures/qwen-asr/audio-reference.json').write_text(json.dumps(output, separators=(',', ':')) + '\n')
print(f'Generated {len(results)} fixtures with NumPy {np.__version__}')
