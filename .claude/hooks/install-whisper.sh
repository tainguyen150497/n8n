#!/bin/bash
# Installs Whisper (large-v3-turbo via sherpa-onnx) so Claude can transcribe audio/video.
# Runs in the background so the session starts immediately.
[ "$CLAUDE_CODE_REMOTE" = "true" ] || exit 0

DIR=/root/whisper
SRC="$CLAUDE_PROJECT_DIR/.claude/skills/whisper/transcribe.py"
[ -f "$DIR/.ready" ] && exit 0

(
	set -e
	mkdir -p "$DIR"
	pip install -q sherpa-onnx numpy
	cd "$DIR"
	if [ ! -d sherpa-onnx-whisper-turbo ]; then
		curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-turbo.tar.bz2 | tar xj
	fi
	[ -f silero_vad.onnx ] || curl -sSL -o silero_vad.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
	cp "$SRC" "$DIR/transcribe.py"
	printf '#!/bin/sh\nexec python3 /root/whisper/transcribe.py "$@"\n' > /usr/local/bin/whisper
	chmod +x /usr/local/bin/whisper
	touch "$DIR/.ready"
) > /tmp/whisper-install.log 2>&1 &
exit 0
