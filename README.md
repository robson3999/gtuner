# Tuner

A buildless HTML, CSS, and JavaScript microphone tuner for guitar, high-G ukulele,
mandolin, and four-string bass. Audio is analyzed locally, never recorded or uploaded.
There are no runtime dependencies, accounts, or backend services.

## Run locally

From this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000. Use a local server, not a `file://` URL (JavaScript modules
need HTTP). Select an instrument and a string, click **Start tuning**, allow the
microphone, and pluck that open string. Mute other strings. Select each mandolin pair
and tune its strings individually, muting the partner string.

Use the **Manual / Auto** toggle above the string buttons to choose how strings are
selected. Manual is the default. Auto selects the closest target pitch for the chosen
instrument after a few steady readings, with a small margin to prevent flickering
between neighboring strings. It distinguishes octaves, including the guitar’s two E
strings. Tapping a string returns to Manual; switching to Manual keeps the current
string selected. Auto mode stays enabled when changing instruments.

The selected note and string turn red when more than 20 cents out, yellow within
20 cents, and green within 5 cents. One cent is 1/100 of a semitone. The meter spans
±50 cents; the numerical reading continues beyond that range. Gray means no reliable
reading. Colors represent the current sound, not saved completion marks.

**Stop tuning**, hiding the tab, or leaving the page releases the microphone. Returning
to the page requires another click on **Start tuning**.

## Host on GitHub Pages

1. Create a GitHub repository and push this directory to it.
2. In the repository, open **Settings → Pages**.
3. Choose **Deploy from a branch**, your pushed branch, and **/ (root)**. Save.
4. Open the published HTTPS URL and enable **Enforce HTTPS** if available.

No build step is needed. All asset paths are relative, including under `/tuner/`.
Microphone access requires HTTPS, except on localhost. A phone visiting a computer’s
plain HTTP LAN address will not have microphone access; use the HTTPS Pages URL.

## Tests

With Node.js 18+ installed:

```sh
npm test
```

The pitch tests use synthetic signals at 44.1 and 48 kHz, including all supported
strings, detuning, strong harmonics, silence, quiet signals, and noise. Application
tests use DOM and audio doubles to check string selection, tuning feedback, recovery
after silence, permission errors, and microphone cleanup, including a pending request
when the tab is hidden. These checks do not replace rendering in a browser or testing
with an actual microphone and instrument.

## PoC limits

- Standard tunings only. Reference pitch is A4 = 440 Hz.
- Auto chooses the closest standard string pitch. Use Manual for a very out-of-tune
  string, whose pitch may be closer to another string’s target.
- Intended for one open string at a time, not chords or noisy environments.
- The YIN-style detector searches 30–900 Hz, including bass E1 and mandolin E5.
  It does not fold incorrect octaves into the expected note.
- A short median filter steadies readings. A weak fundamental or loud background
  note can still confuse the detector. Phone microphones may struggle with low bass.
- Browser audio processing constraints are requests; devices may not honor them.
- Desktop and mobile layouts are supported; real-device microphone quality and
  browser permission behavior need manual verification.

Implementation: `index.html` and `styles.css` provide the interface, `app.js` handles
microphone lifecycle and SVG instruments, and `pitch.js` contains pitch detection
and tuning definitions.
