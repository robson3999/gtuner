// YIN-style difference detector. Downsampling keeps low bass notes affordable
// on phones. A first pass finds the note; a second pass keeps only its first few
// harmonics, because the upper overtones of stiff wound strings run sharp and
// would otherwise pull the reading sharp.
export function detectPitch(input, sampleRate, minFrequency = 30, maxFrequency = 900) {
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  let mean = 0;
  for (let i = 0; i < input.length; i++) mean += input[i];
  mean /= input.length;
  // Skip one cutoff period while the filter settles.
  const estimate = (cutoff, low, high) =>
    findPitch(lowPass(input, sampleRate, cutoff, mean), Math.ceil(sampleRate / cutoff), stride, sampleRate / stride, low, high);
  const coarse = estimate(1000, minFrequency, maxFrequency);
  if (!coarse) return null;
  const semitone = 2 ** (1 / 12);
  return estimate(3 * coarse, Math.max(minFrequency, coarse / semitone), Math.min(maxFrequency, coarse * semitone)) || coarse;
}

// Second-order Butterworth low-pass, also the anti-aliasing filter for downsampling.
function lowPass(input, sampleRate, cutoff, mean) {
  const w = 2 * Math.PI * cutoff / sampleRate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const cos = Math.cos(w);
  const b0 = (1 - cos) / 2 / (1 + alpha);
  const a1 = -2 * cos / (1 + alpha);
  const a2 = (1 - alpha) / (1 + alpha);
  const output = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i] - mean;
    const y = b0 * (x + 2 * x1 + x2) - a1 * y1 - a2 * y2;
    output[i] = y;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return output;
}

function findPitch(filtered, skip, stride, rate, minFrequency, maxFrequency) {
  const samples = new Float32Array(Math.floor((filtered.length - skip) / stride));
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = filtered[skip + i * stride];
    energy += samples[i] ** 2;
  }
  // Keep quiet plucks; the periodicity check below still rejects unpitched noise.
  if (Math.sqrt(energy / samples.length) < 0.002) return null;

  const maxLag = Math.min(Math.ceil(rate / minFrequency), Math.floor(samples.length / 2));
  const minLag = Math.max(2, Math.floor(rate / maxFrequency));
  const window = samples.length - maxLag;
  const difference = new Float32Array(maxLag + 1);
  const normalized = new Float32Array(maxLag + 1);
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let value = 0;
    for (let i = 0; i < window; i++) value += (samples[i] - samples[i + lag]) ** 2;
    difference[lag] = value;
    sum += value;
    normalized[lag] = sum ? value * lag / sum : 1;
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (normalized[lag] >= 0.12) continue;
    while (lag + 1 < maxLag && normalized[lag + 1] < normalized[lag]) lag++;
    // Interpolate the raw difference; the normalized curve biases readings sharp.
    const left = difference[lag - 1];
    const center = difference[lag];
    const right = difference[lag + 1];
    const curvature = left - 2 * center + right;
    const adjustment = curvature ? (left - right) / (2 * curvature) : 0;
    const frequency = rate / (lag + adjustment);
    return frequency >= minFrequency && frequency <= maxFrequency ? frequency : null;
  }
  return null;
}

export function centsFromTarget(frequency, target) {
  return 1200 * Math.log2(frequency / target);
}

export function tuningState(cents) {
  if (Math.abs(cents) <= 5) return "tuned";
  if (Math.abs(cents) <= 20) return "close";
  return "far";
}

export function noteFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export const instruments = {
  guitar: { name: "Acoustic guitar", tuning: "Standard tuning", notes: ["E2", "A2", "D3", "G3", "B3", "E4"], midi: [40, 45, 50, 55, 59, 64] },
  ukulele: { name: "Ukulele", tuning: "Standard · high G", notes: ["G4", "C4", "E4", "A4"], midi: [67, 60, 64, 69] },
  mandolin: { name: "Mandolin", tuning: "Standard · paired strings", notes: ["G3", "D4", "A4", "E5"], midi: [55, 62, 69, 76] },
  bass: { name: "Bass guitar", tuning: "Standard · 4 strings", notes: ["E1", "A1", "D2", "G2"], midi: [28, 33, 38, 43] },
};
