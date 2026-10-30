import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as pitch from "./pitch.js";

// Small DOM/audio doubles exercise application behavior without a microphone.
// These are not a substitute for rendering and real-device browser checks.
class Element {
  dataset = {};
  style = {};
  children = [];
  attributes = {};
  events = {};
  textContent = "";
  hidden = true;
  classList = { add() {}, remove() {}, toggle() {} };
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.events[name] = callback; }
  replaceChildren(...children) { this.children = children; }
  querySelector() { return this.label ||= new Element(); }
  set innerHTML(value) {
    this.children = Array.from({ length: (value.match(/class="instrument-string"/g) || []).length }, () => new Element());
  }
  click() { return this.events.click(); }
}

function setup(getUserMedia) {
  const elements = new Map();
  const get = (selector) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const selectors = Object.keys(pitch.instruments).map((key) => {
    const button = new Element();
    button.dataset.instrument = key;
    return button;
  });
  const modes = ["manual", "auto"].map((mode) => {
    const button = new Element();
    button.dataset.mode = mode;
    return button;
  });
  const document = {
    hidden: false, events: {},
    querySelector: get,
    createElement: () => new Element(),
    addEventListener(name, callback) { this.events[name] = callback; },
    querySelectorAll(selector) {
      if (selector === "[data-instrument]") return selectors;
      if (selector === "[data-mode]") return modes;
      if (selector === ".string-button") return get("#string-buttons").children;
      if (selector === ".instrument-string") return get("#string-drawing").children;
      return [...get("#string-buttons").children, ...get("#string-drawing").children];
    },
  };
  const audio = { frequency: 0, contexts: [], tracks: [] };
  const createStream = () => {
    const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
    audio.tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  class AudioContext {
    sampleRate = 48000;
    state = "running";
    constructor() { audio.contexts.push(this); }
    async resume() {}
    async close() { this.state = "closed"; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() {
      return { getFloatTimeDomainData(samples) {
        for (let i = 0; i < samples.length; i++) samples[i] = audio.frequency ? 0.5 * Math.sin(2 * Math.PI * audio.frequency * i / 48000) : 0;
      } };
    }
  }
  let callback;
  vm.runInNewContext(readFileSync(new URL("./app.js", import.meta.url), "utf8").replace(/^import .*;\n/, ""), {
    ...pitch, document, window: { isSecureContext: true, AudioContext, addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => createStream()) } },
    performance: { now: () => 0 },
    requestAnimationFrame(next) { callback = next; return 1; },
    cancelAnimationFrame() { callback = undefined; },
  });
  return { get, selectors, modes, document, audio, createStream, tick: (time) => callback(time) };
}

test("instrument selection updates labels, string count, and target", () => {
  const app = setup();
  for (const button of app.selectors) {
    button.click();
    const config = pitch.instruments[button.dataset.instrument];
    assert.equal(app.get("#instrument-title").textContent, config.name);
    const strings = app.get("#string-buttons").children;
    assert.equal(strings.length, config.notes.length);
    strings.at(-1).click();
    assert.equal(app.get("#target-note").textContent, config.notes.at(-1)[0]);
    assert.equal(app.get("#target-octave").textContent, config.notes.at(-1)[1]);
    assert.equal(strings.at(-1).attributes["aria-pressed"], "true");
  }
});

test("microphone recovers after silence, shows tuning colors, and releases on stop", async () => {
  const app = setup();
  await app.get("#mic-button").click();
  assert.equal(app.get("#mic-status").textContent, "Listening");
  for (let t = 100; t <= 1000; t += 100) app.tick(t);
  assert.equal(app.get(".tuning-panel").dataset.state, "idle");
  const target = pitch.noteFrequency(40);
  let time = 1000;
  for (const [cents, state] of [[0, "tuned"], [-12, "close"], [35, "far"]]) {
    app.audio.frequency = target * 2 ** (cents / 1200);
    for (let i = 0; i < 6; i++) app.tick(time += 100);
    assert.equal(app.get(".tuning-panel").dataset.state, state);
    assert.equal(app.get("#string-buttons").children[0].dataset.state, state);
  }
  app.audio.frequency = 0;
  for (let i = 0; i < 8; i++) app.tick(time += 100);
  assert.equal(app.get(".tuning-panel").dataset.state, "idle");
  app.get("#mic-button").click();
  assert.ok(app.audio.tracks.every((track) => track.stopped));
  assert.ok(app.audio.contexts.every((context) => context.state === "closed"));
  assert.equal(app.get("#mic-status").textContent, "Mic off");
});

test("permission rejection shows an actionable error and allows retry", async () => {
  const app = setup(async () => { throw Object.assign(new Error(), { name: "NotAllowedError" }); });
  await app.get("#mic-button").click();
  assert.equal(app.get("#error").hidden, false);
  assert.match(app.get("#error").textContent, /permission was denied/);
  assert.equal(app.get("#mic-button").disabled, false);
  assert.equal(app.audio.contexts[0].state, "closed");
});

test("hiding the page cancels pending microphone access and stops late tracks", async () => {
  let resolvePermission;
  let markRequested;
  const requested = new Promise((resolve) => { markRequested = resolve; });
  const permission = new Promise((resolve) => { resolvePermission = resolve; });
  const app = setup(() => { markRequested(); return permission; });
  const pending = app.get("#mic-button").click();
  await requested;
  app.document.hidden = true;
  app.document.events.visibilitychange();
  resolvePermission(app.createStream());
  await pending;
  assert.ok(app.audio.tracks[0].stopped);
  assert.equal(app.audio.contexts[0].state, "closed");
  assert.equal(app.get("#mic-status").textContent, "Mic off");
});

test("manual mode keeps the chosen string when another string sounds", async () => {
  const app = setup();
  await app.get("#mic-button").click();
  app.audio.frequency = pitch.noteFrequency(45);
  for (let time = 100; time <= 600; time += 100) app.tick(time);
  assert.equal(app.get("#target-detail").textContent, "String 6 · Target 82.41 Hz");
  assert.equal(app.get(".tuning-panel").dataset.state, "far");
});

test("auto mode finds every instrument's strings by pitch, including both guitar Es and high-G ukulele", async () => {
  const app = setup();
  app.modes[1].click();
  assert.equal(app.modes[1].attributes["aria-pressed"], "true");
  await app.get("#mic-button").click();
  assert.equal(app.get("#guidance").textContent, "Pluck any open string.");
  let time = 0;
  for (const button of app.selectors) {
    button.click();
    const config = pitch.instruments[button.dataset.instrument];
    for (let index = 0; index < config.midi.length; index++) {
      app.audio.frequency = pitch.noteFrequency(config.midi[index]) * 2 ** (12 / 1200);
      for (let i = 0; i < 6; i++) app.tick(time += 100);
      assert.equal(app.get("#target-note").textContent + app.get("#target-octave").textContent, config.notes[index]);
      assert.equal(app.get("#string-buttons").children[index].attributes["aria-pressed"], "true");
      assert.equal(app.get("#string-buttons").children[index].dataset.state, "close");
    }
  }
});

test("auto selection resists transient notes and boundary jitter, and ignores silence", async () => {
  const app = setup();
  app.selectors[1].click();
  app.modes[1].click();
  await app.get("#mic-button").click();
  let time = 0;
  const play = (midi, frames = 6) => {
    app.audio.frequency = pitch.noteFrequency(midi);
    for (let i = 0; i < frames; i++) app.tick(time += 100);
  };
  play(67);
  play(69, 1);
  assert.equal(app.get("#target-note").textContent, "G");
  for (const midi of [67.97, 68.03, 67.98, 68.02]) {
    play(midi);
    assert.equal(app.get("#target-note").textContent, "G");
  }
  play(69);
  assert.equal(app.get("#target-note").textContent, "A");
  app.audio.frequency = 0;
  for (let i = 0; i < 8; i++) app.tick(time += 100);
  assert.equal(app.get("#target-note").textContent, "A");
  assert.equal(app.get(".tuning-panel").dataset.state, "idle");
});

test("switching to manual locks the current string; tapping a string also selects manual mode", async () => {
  const app = setup();
  app.modes[1].click();
  await app.get("#mic-button").click();
  app.audio.frequency = pitch.noteFrequency(45);
  let time = 0;
  for (let i = 0; i < 6; i++) app.tick(time += 100);
  app.modes[0].click();
  app.audio.frequency = pitch.noteFrequency(64);
  for (let i = 0; i < 6; i++) app.tick(time += 100);
  assert.equal(app.get("#target-note").textContent, "A");
  assert.equal(app.modes[0].attributes["aria-pressed"], "true");
  app.modes[1].click();
  app.get("#string-buttons").children[2].click();
  for (let i = 0; i < 6; i++) app.tick(time += 100);
  assert.equal(app.get("#target-note").textContent, "D");
  assert.equal(app.modes[0].attributes["aria-pressed"], "true");
  assert.equal(app.modes[1].attributes["aria-pressed"], "false");
});
