#!/usr/bin/env python3
"""Transcribe an audio/video file with Whisper (large-v3-turbo via sherpa-onnx).

Usage: whisper <file> [--lang vi|en|...] [--task transcribe|translate]
Prints one line per speech segment: [mm:ss - mm:ss] text
"""
import argparse
import os
import subprocess
import sys

import numpy as np
import sherpa_onnx

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "sherpa-onnx-whisper-turbo")
SR = 16000


def load_audio(path):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, check=True, stdout=subprocess.PIPE).stdout
    return np.frombuffer(raw, dtype=np.float32)


def ts(sec):
    m, s = divmod(int(sec), 60)
    h, m = divmod(m, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("file")
    p.add_argument("--lang", default="", help="ISO code, e.g. vi, en. Empty = auto-detect")
    p.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    p.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    a = p.parse_args()

    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=f"{MODEL}/turbo-encoder.int8.onnx",
        decoder=f"{MODEL}/turbo-decoder.int8.onnx",
        tokens=f"{MODEL}/turbo-tokens.txt",
        language=a.lang,
        task=a.task,
        num_threads=a.threads,
    )

    vad_cfg = sherpa_onnx.VadModelConfig()
    vad_cfg.silero_vad.model = os.path.join(HERE, "silero_vad.onnx")
    vad_cfg.silero_vad.min_silence_duration = 0.4
    vad_cfg.silero_vad.max_speech_duration = 25  # Whisper works on <=30 s windows
    vad_cfg.sample_rate = SR
    vad = sherpa_onnx.VoiceActivityDetector(vad_cfg, buffer_size_in_seconds=120)

    samples = load_audio(a.file)
    if samples.size == 0:
        sys.exit("No audio track found")

    window = vad_cfg.silero_vad.window_size
    segments = []
    for i in range(0, len(samples), window):
        vad.accept_waveform(samples[i : i + window])
        while not vad.empty():
            segments.append((vad.front.start, vad.front.samples))
            vad.pop()
    vad.flush()
    while not vad.empty():
        segments.append((vad.front.start, vad.front.samples))
        vad.pop()

    words = 0
    speech_sec = 0.0
    seg_rms = []
    for start, seg in segments:
        speech_sec += len(seg) / SR
        seg_rms.append(float(np.sqrt(np.mean(np.square(seg)))) if len(seg) else 0.0)
        stream = recognizer.create_stream()
        stream.accept_waveform(SR, seg)
        recognizer.decode_stream(stream)
        text = stream.result.text.strip()
        if text:
            words += len(text.split())
            begin = start / SR
            print(f"[{ts(begin)} - {ts(begin + len(seg) / SR)}] {text}", flush=True)

    # Delivery stats, to judge the speaker's pace and tone
    total = len(samples) / SR
    if segments and speech_sec > 0:
        gaps = [
            (segments[i + 1][0] - (segments[i][0] + len(segments[i][1]))) / SR
            for i in range(len(segments) - 1)
        ]
        long_pauses = sum(1 for g in gaps if g >= 1.0)
        db = [20 * np.log10(r + 1e-9) for r in seg_rms]
        print("\n--- Delivery ---")
        print(f"Duration {ts(total)}, speech {ts(speech_sec)} ({speech_sec / total:.0%})")
        print(f"Pace ~{words / (speech_sec / 60):.0f} words/min, {len(segments)} segments, {long_pauses} pauses >=1s")
        print(f"Loudness avg {np.mean(db):.1f} dBFS, range {min(db):.1f} to {max(db):.1f} dBFS")


if __name__ == "__main__":
    main()
