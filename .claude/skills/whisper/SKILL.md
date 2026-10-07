---
name: whisper
description: Listen to and understand audio or video files by transcribing them locally with OpenAI Whisper (large-v3-turbo). Use whenever the user shares or mentions an audio/video file (mp3, wav, m4a, ogg, opus, flac, webm, mp4, mov, mkv, voice messages…) and wants to know what is said, a transcript, subtitles, a summary, a translation, the speaker's tone/style, or answers about its content.
---

# Whisper: hear audio and video

Claude cannot hear audio directly. Transcribe the file first, then answer from the transcript.

## Steps

1. Make sure Whisper is ready. The SessionStart hook installs it in the background:
   ```bash
   until [ -f /root/whisper/.ready ]; do sleep 5; done   # first run of a session can take ~1 min
   ```
   If it is not ready after a few minutes, check `/tmp/whisper-install.log`, or run
   `CLAUDE_CODE_REMOTE=true .claude/hooks/install-whisper.sh` and wait again.
2. Transcribe (audio and video both work; ffmpeg extracts the sound):
   ```bash
   whisper "<file>" --lang vi        # vi = Vietnamese, en = English; omit --lang to auto-detect
   whisper "<file>" --task translate # translate speech into English
   ```
   Output: one line per speech segment `[mm:ss - mm:ss] text`, then a `--- Delivery ---` block
   with speech pace (words/min), long pauses and loudness — use it to judge the speaker's tone.
   For long files run it in the background and save the output to a file.
3. Answer the user's actual request (summary, Q&A, translation, subtitles, tone/style analysis…)
   from the transcript, in the user's language. Quote timestamps when useful. Note that words may
   be misheard where the transcript looks wrong, and that emotion is inferred from words and
   delivery stats, not heard directly.
