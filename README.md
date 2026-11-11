# General AI Voice Assistant

This version answers open-ended questions with an AI model rather than following fixed sample prompts. It remembers the current chat, speaks answers aloud, and can keep listening for the next voice turn. When you pause after speaking, the browser stops the audio clip, sends it to Groq Whisper for transcription, then sends the resulting text to the chat model.

## Run it

1. Install Node.js 20 or newer if it is not already installed.
2. Open PowerShell in this folder and run `./Start-Voice-KAM.ps1`. Enter your Groq API key at the hidden prompt.

3. Open `http://127.0.0.1:4175` in Chrome and allow microphone access. Type in the box or select **Talk** and speak. Pause for about 1.4 seconds to submit your voice turn. Select **Stop & send** to submit manually.

The key stays in the server process environment and is not sent to the browser or saved in these files. API requests use Groq's Chat Completions API and the `openai/gpt-oss-120b` model by default; voice transcription uses `whisper-large-v3-turbo`. Usage follows your Groq account's limits and pricing. Change the chat model with `$env:GROQ_MODEL` before starting the server. Voice recording uses the browser MediaRecorder API and requires microphone access on localhost.

Use **Stop speaking** to interrupt spoken output. The **Voice settings** navbar menu lets you choose a browser voice and adjust speed, pitch, and volume. **Test voice** previews the selected settings; preferences are saved in this browser.

Answers are kept concise by default so spoken responses finish as a single complete reply. The server retries with a shorter answer if the model reports that it hit the response limit. Standard Markdown is rendered in the chat, including encoded spaces and common HTML entities.

The model produces answers from its trained knowledge and the conversation context. This prototype does not browse the web, access current data, or connect to Snapdeal; the assistant is instructed to say when it cannot verify current information.
