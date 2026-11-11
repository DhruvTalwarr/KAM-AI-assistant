(() => {
  const messages = document.querySelector('#messages');
  const form = document.querySelector('#compose');
  const input = document.querySelector('#typed');
  const mic = document.querySelector('#mic');
  const status = document.querySelector('#status');
  const themeToggle = document.querySelector('#themeToggle');
  const voiceMenu = document.querySelector('.nav-menu');
  const stopSpeakingButton = document.querySelector('#stopSpeaking');
  const voiceChoice = document.querySelector('#voiceChoice');
  const voiceRate = document.querySelector('#voiceRate');
  const voicePitch = document.querySelector('#voicePitch');
  const voiceVolume = document.querySelector('#voiceVolume');
  const history = [];
  let voiceMode = false;
  let busy = false;
  let recorder = null;
  let stream = null;
  let audioContext = null;
  let analyser = null;
  let chunks = [];
  let meterTimer = null;
  let silenceTimer = null;
  let maxTimer = null;
  let heardSpeech = false;
  let forceSend = false;
  let speechToken = 0;

  function decodeEntities(text) {
    return text
      .replace(/&#(?:x([\da-f]{1,6})|(\d{1,7}));/gi, (entity, hex, decimal) => {
        const codePoint = Number.parseInt(hex || decimal, hex ? 16 : 10);
        if (!Number.isFinite(codePoint) || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
        return String.fromCodePoint(codePoint);
      })
      .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, entity => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()]));
  }

  function renderInline(parent, text) {
    const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
      let node;
      if (match[1]) { node = document.createElement('strong'); node.textContent = match[1]; }
      else if (match[2]) { node = document.createElement('em'); node.textContent = match[2]; }
      else if (match[3]) { node = document.createElement('code'); node.textContent = match[3]; }
      else { node = document.createElement('a'); node.textContent = match[4]; node.href = match[5]; node.target = '_blank'; node.rel = 'noopener noreferrer'; }
      parent.append(node);
      cursor = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(cursor)));
  }

  function isTableRow(line) { return /^\s*\|.*\|\s*$/.test(line); }
  function isTableDivider(line) { return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line); }
  function listInfo(line) {
    const match = line.match(/^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.*)$/);
    return match ? { type: match[2] ? 'ol' : 'ul', text: match[3] } : null;
  }

  function renderMarkdown(text, target) {
    const lines = decodeEntities(text).replace(/\r/g, '').split('\n');
    let i = 0;
    const cellText = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) { i++; continue; }
      if (/^```/.test(line)) {
        i++;
        const content = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) content.push(lines[i++]);
        if (i < lines.length) i++;
        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = content.join('\n');
        pre.append(code); target.append(pre); continue;
      }
      if (i + 1 < lines.length && isTableRow(lines[i]) && isTableDivider(lines[i + 1])) {
        const wrapper = document.createElement('div'); wrapper.className = 'markdown-table-wrap';
        const table = document.createElement('table');
        const head = document.createElement('thead'); const headRow = document.createElement('tr');
        for (const value of cellText(lines[i])) { const th = document.createElement('th'); renderInline(th, value); headRow.append(th); }
        head.append(headRow); table.append(head); i += 2;
        const body = document.createElement('tbody');
        while (i < lines.length && isTableRow(lines[i])) {
          const row = document.createElement('tr');
          for (const value of cellText(lines[i])) { const td = document.createElement('td'); renderInline(td, value); row.append(td); }
          body.append(row); i++;
        }
        table.append(body); wrapper.append(table); target.append(wrapper); continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) { const h = document.createElement(`h${heading[1].length}`); renderInline(h, heading[2]); target.append(h); i++; continue; }
      if (/^(---+|\*\*\*+|___+)\s*$/.test(line)) { target.append(document.createElement('hr')); i++; continue; }
      const firstItem = listInfo(lines[i]);
      if (firstItem) {
        const list = document.createElement(firstItem.type);
        while (i < lines.length) {
          const item = listInfo(lines[i]);
          if (!item || item.type !== firstItem.type) break;
          const li = document.createElement('li'); renderInline(li, item.text); list.append(li); i++;
        }
        target.append(list); continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = document.createElement('blockquote');
        const p = document.createElement('p');
        while (i < lines.length && /^\s*>/.test(lines[i])) { if (p.childNodes.length) p.append(document.createTextNode(' ')); renderInline(p, lines[i++].replace(/^\s*>\s?/, '')); }
        quote.append(p); target.append(quote); continue;
      }
      const paragraph = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|---+\s*$)/.test(lines[i]) && !listInfo(lines[i]) && !(i + 1 < lines.length && isTableRow(lines[i]) && isTableDivider(lines[i + 1]))) paragraph.push(lines[i++].trim());
      if (!paragraph.length) { paragraph.push(lines[i++].trim()); }
      const p = document.createElement('p'); renderInline(p, paragraph.join(' ')); target.append(p);
    }
  }

  function speechText(markdown) {
    return decodeEntities(markdown).replace(/```[\s\S]*?```/g, ' code block omitted ')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
      .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, '')
      .replace(/[|]/g, ', ').replace(/^\s*#{1,6}\s*/gm, '').replace(/^\s*[-+*]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '').replace(/^\s*>\s?/gm, '')
      .replace(/\*\*|__|[*_`]/g, '').replace(/\s+/g, ' ').trim();
  }

  function add(text, who = 'bot') {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${who}`;
    const speaker = document.createElement('div');
    speaker.className = 'speaker';
    speaker.textContent = who === 'bot' ? 'AI assistant' : 'You';
    const body = document.createElement('div');
    if (who === 'bot') renderMarkdown(text, body);
    else body.textContent = text;
    bubble.append(speaker, body);
    messages.append(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  function setStatus(text) { status.textContent = text; }

  function setTheme(theme) {
    const dark = theme === 'dark';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    themeToggle.textContent = dark ? '☀️ Light mode' : '🌙 Dark mode';
    themeToggle.setAttribute('aria-pressed', String(dark));
    try { localStorage.setItem('voice-kam-theme', dark ? 'dark' : 'light'); } catch {}
  }

  try { setTheme(localStorage.getItem('voice-kam-theme') || 'light'); }
  catch { setTheme('light'); }
  themeToggle.addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.addEventListener('click', event => { if (!voiceMenu.contains(event.target)) voiceMenu.open = false; });

  function saveVoiceSetting(key, value) {
    try { localStorage.setItem(`voice-kam-${key}`, value); } catch {}
  }

  function loadVoiceSettings() {
    try {
      const rate = Number(localStorage.getItem('voice-kam-rate'));
      const pitch = Number(localStorage.getItem('voice-kam-pitch'));
      const volume = Number(localStorage.getItem('voice-kam-volume'));
      if (rate >= 0.7 && rate <= 1.5) voiceRate.value = String(rate);
      if (pitch >= 0.7 && pitch <= 1.4) voicePitch.value = String(pitch);
      if (volume >= 0 && volume <= 1) voiceVolume.value = String(volume);
    } catch {}
    document.querySelector('#rateValue').value = `${Number(voiceRate.value).toFixed(1)}×`;
    document.querySelector('#pitchValue').value = Number(voicePitch.value).toFixed(1);
    document.querySelector('#volumeValue').value = `${Math.round(Number(voiceVolume.value) * 100)}%`;
  }

  function populateVoices() {
    if (!('speechSynthesis' in window)) return;
    let saved = '';
    try { saved = localStorage.getItem('voice-kam-voice') || ''; } catch {}
    const previous = voiceChoice.value || saved;
    voiceChoice.querySelectorAll('option:not(:first-child)').forEach(option => option.remove());
    for (const voice of window.speechSynthesis.getVoices()) {
      const option = document.createElement('option');
      option.value = voice.voiceURI;
      option.textContent = `${voice.name} (${voice.lang})${voice.default ? ' · default' : ''}`;
      voiceChoice.append(option);
    }
    if ([...voiceChoice.options].some(option => option.value === previous)) voiceChoice.value = previous;
  }

  loadVoiceSettings();
  populateVoices();
  if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
  voiceChoice.addEventListener('change', () => saveVoiceSetting('voice', voiceChoice.value));
  voiceRate.addEventListener('input', () => { document.querySelector('#rateValue').value = `${Number(voiceRate.value).toFixed(1)}×`; saveVoiceSetting('rate', voiceRate.value); });
  voicePitch.addEventListener('input', () => { document.querySelector('#pitchValue').value = Number(voicePitch.value).toFixed(1); saveVoiceSetting('pitch', voicePitch.value); });
  voiceVolume.addEventListener('input', () => { document.querySelector('#volumeValue').value = `${Math.round(Number(voiceVolume.value) * 100)}%`; saveVoiceSetting('volume', voiceVolume.value); });

  function speak(text, done) {
    if (!('speechSynthesis' in window)) return done?.();
    const token = ++speechToken;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText(text));
    utterance.rate = Number(voiceRate.value);
    utterance.pitch = Number(voicePitch.value);
    utterance.volume = Number(voiceVolume.value);
    const selectedVoice = window.speechSynthesis.getVoices().find(voice => voice.voiceURI === voiceChoice.value);
    if (selectedVoice) utterance.voice = selectedVoice;
    stopSpeakingButton.disabled = false;
    const complete = () => {
      if (token !== speechToken) return;
      stopSpeakingButton.disabled = true;
      done?.();
    };
    utterance.onend = complete;
    utterance.onerror = complete;
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    speechToken++;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    stopSpeakingButton.disabled = true;
    if (voiceMode && !busy) {
      setStatus('Listening…');
      startRecording();
    } else setStatus('Speech stopped');
  }

  stopSpeakingButton.addEventListener('click', stopSpeaking);
  document.querySelector('#testVoice').addEventListener('click', () => {
    setStatus('Voice preview');
    speak('Hello. This is a preview of your selected voice settings.', () => setStatus('Ready'));
  });

  function clearCaptureTimers() {
    clearInterval(meterTimer);
    clearTimeout(silenceTimer);
    clearTimeout(maxTimer);
    meterTimer = silenceTimer = maxTimer = null;
  }

  async function submitAudio(blob) {
    if (!blob || blob.size < 1200) {
      add('I didn’t catch any speech. Tap Talk and try again.');
      if (voiceMode) startRecording();
      else { mic.disabled = false; mic.textContent = '🎙 Talk'; setStatus('Ready'); }
      return;
    }
    setStatus('Transcribing your audio…');
    try {
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < buffer.length; offset += 0x8000) binary += String.fromCharCode(...buffer.subarray(offset, offset + 0x8000));
      const audioBase64 = btoa(binary);
      const response = await fetch('/api/transcribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType: blob.type || 'audio/webm' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Audio transcription failed.');
      const transcript = (data.transcript || '').trim();
      if (!transcript) throw new Error('I could not make out those words. Try again a little closer to the mic.');
      await ask(transcript, true);
    } catch (error) {
      const message = error.message.toLowerCase().includes('fetch')
        ? 'Could not reach the audio transcription endpoint. Open this app at http://127.0.0.1:4174 and make sure server.mjs is running.'
        : error.message;
      add(message);
      mic.disabled = false;
      if (voiceMode) {
        setStatus('Speaking…');
        speak(message, () => { if (voiceMode) startRecording(); });
      } else { mic.textContent = '🎙 Talk'; setStatus('Ready'); }
    }
  }

  async function startRecording() {
    if (!voiceMode || busy || recorder?.state === 'recording') return;
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Microphone recording is unavailable in this browser. Open this app at localhost in Chrome or Edge.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      chunks = [];
      heardSpeech = false;
      forceSend = false;
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        clearCaptureTimers();
        stream?.getTracks().forEach(track => track.stop());
        stream = null;
        audioContext?.close().catch(() => {});
        audioContext = null;
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (!heardSpeech && !forceSend) {
          add('I didn’t hear speech. Try again, or check that the correct microphone is selected.');
          mic.disabled = false;
          mic.textContent = '🎙 Talk';
          setStatus('Ready');
          if (voiceMode) setTimeout(startRecording, 400);
        } else submitAudio(blob);
      };

      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      recorder.start(250);
      mic.disabled = false;
      mic.textContent = '■ Stop & send';
      setStatus('Listening… pause to send');
      meterTimer = setInterval(() => {
        if (!analyser || recorder?.state !== 'recording') return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const value of samples) { const n = (value - 128) / 128; sum += n * n; }
        const volume = Math.sqrt(sum / samples.length);
        if (volume > 0.018) {
          heardSpeech = true;
          clearTimeout(silenceTimer);
          silenceTimer = setTimeout(() => stopRecording(), 1400);
        }
      }, 100);
      maxTimer = setTimeout(() => stopRecording(), 20000);
    } catch (error) {
      voiceMode = false;
      mic.disabled = false;
      mic.textContent = '🎙 Talk';
      setStatus('Microphone unavailable');
      add(error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access for localhost in the site controls beside the address bar, then try again.'
        : error.message || 'Could not open the microphone. Check your browser and microphone settings.');
    }
  }

  function stopRecording(sendEvenIfQuiet = false) {
    clearCaptureTimers();
    if (sendEvenIfQuiet) forceSend = true;
    if (recorder?.state === 'recording') recorder.stop();
  }

  async function ask(text, fromVoice = false) {
    text = text.trim();
    if (!text || busy) return;
    add(text, 'seller');
    input.value = '';
    history.push({ role: 'user', content: text });
    busy = true;
    mic.disabled = true;
    setStatus('Thinking…');
    const pending = document.createElement('div');
    pending.className = 'bubble bot';
    pending.textContent = 'Thinking…';
    messages.append(pending);
    messages.scrollTop = messages.scrollHeight;
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-20) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The AI request failed.');
      const answer = (data.answer || '').trim() || 'I could not produce a reply. Please try again.';
      history.push({ role: 'assistant', content: answer });
      pending.remove();
      add(answer);
      busy = false;
      mic.disabled = false;
      if (fromVoice) {
        setStatus('Speaking…');
        speak(answer, () => { if (voiceMode) startRecording(); else { setStatus('Ready'); mic.textContent = '🎙 Talk'; } });
      } else setStatus('Ready');
    } catch (error) {
      pending.remove();
      add(error.message.includes('fetch')
        ? 'Could not reach the AI server. Start it with the instructions in README.md.'
        : error.message);
      busy = false;
      mic.disabled = false;
      if (fromVoice && voiceMode) speak(error.message, () => { if (voiceMode) startRecording(); });
      else { mic.textContent = '🎙 Talk'; setStatus('Ready'); }
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value, false);
  });

  mic.addEventListener('click', () => {
    if (busy) return;
    if (voiceMode) {
      voiceMode = false;
      mic.disabled = true;
      setStatus('Sending audio…');
      stopRecording(true);
      if (!recorder || recorder.state !== 'recording') {
        mic.disabled = false;
        mic.textContent = '🎙 Talk';
        setStatus('Ready');
      }
    } else {
      voiceMode = true;
      startRecording();
    }
  });

  document.querySelector('#reset').addEventListener('click', () => {
    voiceMode = false;
    stopRecording();
    speechToken++;
    window.speechSynthesis?.cancel();
    stopSpeakingButton.disabled = true;
    history.length = 0;
    messages.replaceChildren();
    busy = false;
    mic.disabled = false;
    mic.textContent = '🎙 Talk';
    setStatus('Ready');
    add('Hi! Ask me anything by voice or text. I’ll respond using the AI model and keep the conversation context.');
  });

  add('Hi! Ask me anything by voice or text. I’ll respond using the AI model and keep the conversation context.');
})();
