import { detectPitch, centsFromTarget, tuningState, noteFrequency, instruments } from "./pitch.js";

const $ = (selector) => document.querySelector(selector);
const micButton = $("#mic-button");
let instrument = "guitar";
let selected = 0;
let selectionMode = "auto";
let context;
let stream;
let source;
let analyser;
let samples;
let frame;
let running = false;
let generation = 0;
let history = [];
let lastSignal = 0;
let lastFrame = 0;
let wakeLock;

function clearReading() {
  history = [];
  $(".tuning-panel").dataset.state = "idle";
  $("#needle").style.opacity = "0";
  $("#guidance").textContent = running
    ? selectionMode === "auto" ? "Pluck any open string." : "Pluck the selected string."
    : "Let’s hear your first string.";
  $("#measurement").textContent = running ? "Listening for a clear, steady note…" : "Start the microphone when you’re ready.";
  document.querySelectorAll(".string-button, .instrument-string").forEach((element) => delete element.dataset.state);
}

function chooseMode(mode) {
  selectionMode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  $(".select-hint").textContent = mode === "auto" ? "Pluck any string" : "Pick a string";
  clearReading();
}

function selectString(index) {
  selected = index;
  clearReading();
  const config = instruments[instrument];
  $("#target-note").textContent = config.notes[index][0];
  $("#target-octave").textContent = config.notes[index][1];
  const label = instrument === "mandolin" ? "Pair" : "String";
  $("#target-detail").textContent = `${label} ${config.notes.length - index} · Target ${noteFrequency(config.midi[index]).toFixed(2)} Hz`;
  document.querySelectorAll(".string-button").forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
  document.querySelectorAll(".instrument-string").forEach((line, i) => line.classList.toggle("selected", i === index));
}

function drawInstrument() {
  const config = instruments[instrument];
  const isBass = instrument === "bass";
  const isMandolin = instrument === "mandolin";
  const isUke = instrument === "ukulele";
  const body = isBass
    ? "M270 240 C230 180 230 235 234 277 C155 292 167 415 237 434 Q300 455 363 434 C433 415 445 292 366 277 C370 235 370 180 330 240 Z"
    : isMandolin
      ? "M278 239 C255 265 199 280 190 347 C175 457 425 457 410 347 C401 280 345 265 322 239 Z"
      : isUke
        ? "M274 238 C234 222 211 251 229 282 C247 310 188 322 206 383 C229 451 371 451 394 383 C412 322 353 310 371 282 C389 251 366 222 326 238 Z"
        : "M270 218 C222 191 191 234 219 279 C242 316 163 322 178 387 C195 469 405 469 422 387 C437 322 358 316 381 279 C409 234 378 191 330 218 Z";
  $("#instrument-drawing").innerHTML = `
    <ellipse cx="300" cy="449" rx="109" ry="9" fill="#253c340c"/>
    <path d="${body}" fill="url(#wood)" stroke="#a56e43" stroke-width="3"/>
    <path d="${body}" fill="none" stroke="#f4d9a6" stroke-width="2" transform="translate(9 10) scale(.97)"/>
    ${isBass ? '<rect x="261" y="312" width="78" height="18" rx="4" fill="#3c3c32"/><rect x="261" y="350" width="78" height="18" rx="4" fill="#3c3c32"/><circle cx="373" cy="390" r="7" fill="#e9debb"/>' : '<circle cx="300" cy="320" r="41" fill="#c58e58" stroke="#f0d5a1" stroke-width="4"/><circle cx="300" cy="320" r="34" fill="#383c30"/>'}
    <path d="M268 65 Q300 50 332 65 L329 125 L271 125 Z" fill="#a7744e" stroke="#92603e" stroke-width="2"/>
    <rect x="274" y="121" width="52" height="166" rx="2" fill="#565044"/>
    ${Array.from({ length: 11 }, (_, i) => `<path d="M274 ${132 + i * 14}h52" stroke="#b2a48d" stroke-width="1.5"/>`).join("")}
    <path d="M274 123h52" stroke="#f7eccf" stroke-width="5"/>
    <circle cx="300" cy="167" r="3" fill="#e5dabd"/><circle cx="300" cy="209" r="3" fill="#e5dabd"/><circle cx="300" cy="251" r="3" fill="#e5dabd"/>
    <rect x="255" y="387" width="90" height="19" rx="5" fill="#53483b"/>
    <path d="M269 393h62" stroke="#ede1c1" stroke-width="4"/>
    ${Array.from({ length: isMandolin ? 4 : config.notes.length / 2 }, (_, i) => 76 + i * (isMandolin ? 12 : 18)).map((y) => `<path d="M268 ${y}h-14 M332 ${y}h14" stroke="#918d7a" stroke-width="4"/><rect x="246" y="${y - 5}" width="11" height="10" rx="3" fill="#c6c7b6"/><rect x="343" y="${y - 5}" width="11" height="10" rx="3" fill="#c6c7b6"/>`).join("")}`;
  $("#string-drawing").innerHTML = config.notes.map((note, i) => {
    const x = 280 + i * 40 / (config.notes.length - 1);
    const top = (i + .5) * 600 / config.notes.length;
    return `<g class="instrument-string"><path d="M${top} 4 L${top} 20 L${x} 57" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5"/><path d="M${x} 69 V397" stroke="currentColor" stroke-width="${2.8 - i * .25}"/>${isMandolin ? `<path d="M${x + 4} 69 V397" stroke="currentColor" stroke-width="1.5"/>` : ""}<circle cx="${x}" cy="70" r="3" fill="#eee5ce"/></g>`;
  }).join("");
  $("#instrument-art").setAttribute("aria-label", `${config.name}, strings ${config.notes.join(", ")}${isMandolin ? ", each note has two strings" : ""}`);
}

function chooseInstrument(key) {
  instrument = key;
  const config = instruments[key];
  document.querySelectorAll("[data-instrument]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.instrument === key)));
  $("#instrument-title").textContent = config.name;
  $("#tuning-name").textContent = config.tuning;
  $("#string-buttons").replaceChildren(...config.notes.map((note, i) => {
    const button = document.createElement("button");
    button.className = "string-button";
    button.type = "button";
    button.innerHTML = `${note[0]}<sub>${note[1]}</sub>`;
    button.setAttribute("aria-label", `${instrument === "mandolin" ? "Pair" : "String"} ${config.notes.length - i}: ${note}`);
    button.addEventListener("click", () => {
      chooseMode("manual");
      selectString(i);
    });
    return button;
  }));
  drawInstrument();
  selectString(0);
}

function showPitch(frequency) {
  if (selectionMode === "auto") {
    const distances = instruments[instrument].midi.map((midi) => Math.abs(centsFromTarget(frequency, noteFrequency(midi))));
    const closest = distances.indexOf(Math.min(...distances));
    // Keep the current string near a midpoint to prevent selection flicker.
    if (closest !== selected && distances[selected] - distances[closest] > 30) selectString(closest);
  }
  const target = noteFrequency(instruments[instrument].midi[selected]);
  const cents = centsFromTarget(frequency, target);
  const state = tuningState(cents);
  $(".tuning-panel").dataset.state = state;
  $("#string-buttons").children[selected].dataset.state = state;
  $("#string-drawing").children[selected].dataset.state = state;
  $("#needle").style.opacity = "1";
  $("#needle").style.left = `${50 + Math.max(-50, Math.min(50, cents))}%`;
  const guidance = state === "tuned" ? "That’s the sweet spot." : cents < 0 ? "Too low. Tighten slowly." : "Too high. Loosen slowly.";
  if ($("#guidance").textContent !== guidance) $("#guidance").textContent = guidance;
  $("#measurement").textContent = `${frequency.toFixed(1)} Hz · ${cents >= 0 ? "+" : ""}${Math.round(cents)} cents${state === "tuned" ? " · In tune" : ""}`;
}

function listen(time) {
  if (!running) return;
  frame = requestAnimationFrame(listen);
  if (time - lastFrame < 30) return;
  lastFrame = time;
  analyser.getFloatTimeDomainData(samples);
  // Manual only searches within a fifth of the chosen string, so an octave slip can't mislead.
  const target = noteFrequency(instruments[instrument].midi[selected]);
  const frequency = selectionMode === "manual"
    ? detectPitch(samples, context.sampleRate, target / 2 ** (7 / 12), target * 2 ** (7 / 12))
    : detectPitch(samples, context.sampleRate);
  if (frequency) {
    lastSignal = time;
    if (history.length && Math.abs(centsFromTarget(frequency, history[history.length - 1])) > 60) history = [];
    history.push(frequency);
    if (history.length > 5) history.shift();
    if (history.length >= 3) {
      const sorted = [...history].sort((a, b) => a - b);
      showPitch(sorted[Math.floor(sorted.length / 2)]);
    }
  }
  // Brief dropouts keep the history; sustained silence clears it.
  if (time - lastSignal > 600) clearReading();
}

function stopMicrophone() {
  generation++;
  running = false;
  cancelAnimationFrame(frame);
  stream?.getTracks().forEach((track) => track.stop());
  source?.disconnect();
  if (context && context.state !== "closed") context.close().catch(() => {});
  wakeLock?.release().catch(() => {});
  stream = source = analyser = context = wakeLock = undefined;
  micButton.disabled = false;
  micButton.querySelector("span").textContent = "Start tuning";
  $("#mic-status").textContent = "Mic off";
  $("#mic-status").classList.remove("active");
  $("#audio-info").hidden = true;
  clearReading();
}

// Shows what the phone actually applied; voice processing can suppress a sustained note.
function showAudioInfo() {
  const settings = stream.getAudioTracks()[0].getSettings?.() || {};
  const processing = { echoCancellation: "echo cancellation", noiseSuppression: "noise suppression", autoGainControl: "auto gain" };
  const active = Object.keys(processing).filter((key) => settings[key]).map((key) => processing[key]);
  const details = [`Audio ${context.sampleRate / 1000} kHz`];
  if (settings.sampleRate && settings.sampleRate !== context.sampleRate) details.push(`mic ${settings.sampleRate / 1000} kHz`);
  if (active.length) details.push(`Voice processing on (${active.join(", ")}); readings may drop out`);
  else if (Object.keys(processing).some((key) => key in settings)) details.push("Voice processing off");
  $("#audio-info").textContent = details.join(" · ");
  $("#audio-info").hidden = false;
}

async function startMicrophone() {
  $("#error").hidden = true;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $("#error").textContent = "Microphone access needs HTTPS or localhost and a supported browser. Open the HTTPS GitHub Pages address, or run the local server in the README.";
    $("#error").hidden = false;
    return;
  }
  const request = ++generation;
  // Keep the screen on while tuning; auto-lock would hide the page and stop the microphone.
  navigator.wakeLock?.request("screen").then((lock) => {
    if (request === generation) wakeLock = lock;
    else lock.release().catch(() => {});
  }).catch(() => {});
  micButton.disabled = true;
  micButton.querySelector("span").textContent = "Allow microphone access…";
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    context = new AudioContext();
    // Resume directly from the button gesture for mobile browser audio policies.
    await context.resume();
    if (request !== generation) return;
    const incoming = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    if (request !== generation) {
      incoming.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = incoming;
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    samples = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    // Never connect the microphone to the speakers (avoids feedback).
    stream.getAudioTracks()[0].addEventListener("ended", stopMicrophone);
    running = true;
    lastSignal = performance.now();
    lastFrame = 0;
    clearReading();
    micButton.disabled = false;
    micButton.querySelector("span").textContent = "Stop tuning";
    $("#mic-status").textContent = "Listening";
    $("#mic-status").classList.add("active");
    showAudioInfo();
    frame = requestAnimationFrame(listen);
  } catch (error) {
    if (request !== generation) return;
    stopMicrophone();
    const messages = {
      NotAllowedError: "Microphone permission was denied. Allow microphone access in your browser’s site settings, then try again.",
      NotFoundError: "No microphone was found. Connect a microphone and try again.",
      NotReadableError: "The microphone couldn’t be opened. Close other apps using it and try again.",
    };
    $("#error").textContent = messages[error.name] || "The microphone couldn’t start. Check your browser’s audio permissions and try again.";
    $("#error").hidden = false;
  }
}

document.querySelectorAll("[data-instrument]").forEach((button) => button.addEventListener("click", () => chooseInstrument(button.dataset.instrument)));
document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => chooseMode(button.dataset.mode)));
micButton.addEventListener("click", () => running ? stopMicrophone() : startMicrophone());
document.addEventListener("visibilitychange", () => { if (document.hidden) stopMicrophone(); });
window.addEventListener("pagehide", stopMicrophone);
chooseInstrument("guitar");
