import test from "node:test";
import assert from "node:assert/strict";
import { detectPitch, centsFromTarget, tuningState, noteFrequency, instruments } from "./pitch.js";

function tone(frequency, sampleRate, harmonics = [0.5], amplitude = 1) {
  return Float32Array.from({ length: 8192 }, (_, i) => amplitude * harmonics.reduce((sum, gain, h) => sum + gain * Math.sin(2 * Math.PI * frequency * (h + 1) * i / sampleRate + 0.3), 0));
}

for (const sampleRate of [44100, 48000]) {
  for (const [instrument, config] of Object.entries(instruments)) {
    test(`${instrument}: all strings at ${sampleRate} Hz`, () => {
      for (const midi of config.midi) {
        const expected = noteFrequency(midi);
        const actual = detectPitch(tone(expected, sampleRate), sampleRate);
        assert.ok(actual && Math.abs(centsFromTarget(actual, expected)) < 3, `${expected}: got ${actual}`);
      }
    });
  }
  test(`detuning and harmonics at ${sampleRate} Hz`, () => {
    for (const midi of [28, 40, 57, 76]) {
      for (const cents of [-35, -12, 0, 12, 35]) {
        const target = noteFrequency(midi);
        const frequency = target * 2 ** (cents / 1200);
        const actual = detectPitch(tone(frequency, sampleRate, [0.22, 0.5, 0.16]), sampleRate);
        assert.ok(actual && Math.abs(centsFromTarget(actual, target) - cents) < 3, `${frequency}: got ${actual}`);
      }
    }
  });
  test(`quiet high E remains detectable as it decays at ${sampleRate} Hz`, () => {
    for (const cents of [-35, 0, 35]) {
      const expected = noteFrequency(64) * 2 ** (cents / 1200);
      for (const amplitude of [0.004, 0.006, 0.01]) {
        const actual = detectPitch(tone(expected, sampleRate, [1], amplitude), sampleRate);
        assert.ok(actual && Math.abs(centsFromTarget(actual, expected)) < 3, `amplitude ${amplitude}: got ${actual}`);
      }
      let seed = 42;
      const pluck = tone(expected, sampleRate, [0.65, 0.3, 0.05], 0.008).map((value, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return value * Math.exp(-i / sampleRate / 0.5) + (seed / 2 ** 32 - 0.5) * 0.002;
      });
      const actual = detectPitch(pluck, sampleRate);
      assert.ok(actual && Math.abs(centsFromTarget(actual, expected)) < 3, `decaying pluck with noise: got ${actual}`);
    }
  });
}

test("rejects silence, DC offset, quiet tones, and deterministic broadband noise", () => {
  assert.equal(detectPitch(new Float32Array(8192), 48000), null);
  assert.equal(detectPitch(new Float32Array(8192).fill(0.2), 48000), null);
  assert.equal(detectPitch(tone(110, 48000, [0.5], 0.001), 48000), null);
  let seed = 42;
  const noise = Float32Array.from({ length: 8192 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 2 ** 32 - 0.5) * 0.5;
  });
  for (const amplitude of [0.01, 0.04, 1]) {
    assert.equal(detectPitch(noise.map((value) => value * amplitude), 48000), null);
  }
});

test("tuning thresholds and direction; wrong octaves never count as in tune", () => {
  for (const cents of [-5, 0, 5]) assert.equal(tuningState(cents), "tuned");
  for (const cents of [-20, -5.1, 5.1, 20]) assert.equal(tuningState(cents), "close");
  for (const cents of [-1200, -20.1, 20.1, 1200]) assert.equal(tuningState(cents), "far");
  assert.equal(centsFromTarget(220, 110), 1200);
  assert.equal(centsFromTarget(55, 110), -1200);
  assert.equal(noteFrequency(69), 440);
});
