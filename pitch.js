// YIN-style difference detector. Downsampling keeps low bass notes affordable
// on phones; averaging before decimation reduces high-frequency interference.
export function detectPitch(input, sampleRate) {
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const rate = sampleRate / stride;
  const samples = new Float32Array(Math.floor(input.length / stride));
  let energy = 0;
  let mean = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = 0; j < stride; j++) samples[i] += input[i * stride + j] / stride;
    mean += samples[i];
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) {
    samples[i] -= mean;
    energy += samples[i] ** 2;
  }
  // Keep quiet plucks; the periodicity check below still rejects unpitched noise.
  if (Math.sqrt(energy / samples.length) < 0.002) return null;

  const maxLag = Math.min(Math.ceil(rate / 30), Math.floor(samples.length / 2));
  const minLag = Math.max(2, Math.floor(rate / 900));
  const window = samples.length - maxLag;
  const difference = new Float32Array(maxLag + 1);
  let sum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let value = 0;
    for (let i = 0; i < window; i++) value += (samples[i] - samples[i + lag]) ** 2;
    sum += value;
    difference[lag] = sum ? value * lag / sum : 1;
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] >= 0.12) continue;
    while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
    const left = difference[lag - 1];
    const center = difference[lag];
    const right = difference[lag + 1];
    const curvature = left - 2 * center + right;
    const adjustment = curvature ? (left - right) / (2 * curvature) : 0;
    const frequency = rate / (lag + adjustment);
    return frequency >= 30 && frequency <= 900 ? frequency : null;
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
