---
title: Making the extension's demo videos
type: guide
status: current
tags: [video, tts, extension, youtube, howto]
project: clx
date: 2026-11-13
---

# Making the extension's demo videos

On 13.11.2026 we made the SVG QR Code Generator extension's demo videos with free tools and no
editor:

- **Seven narrated videos**, one per UI language: en, ru, de, es, fr, pt-BR, tr.
- **Seven silent loops** for the generator page.

This file records how it was done and what went wrong, so the next video (here or in another
project) starts from the working recipe rather than from the first attempt.

The scripts are not in this repository. They are kept on the maintainer's machine with the
outputs, and they assume that machine's paths. This file gives the method, the settings and the
pitfalls, not a ready command line. Inputs a new run needs:

- the extension's unpacked release build (the folder with `manifest.json`);
- Node with Playwright and its Chromium;
- ffmpeg;
- the demo page's live address in each language;
- the site's fonts, favicon and icon sprite for the stage;
- the pages' titles and keywords for the upload sheet (here `public/keywords.json`).

**Status: the audio has not been heard by a person.** Only Whisper checked it. See *Limits*.

## The result

| What | Format | Size |
|---|---|---|
| Narrated video, one per language | 1920x1080, 30 fps, H.264 CRF 18, AAC 160k at −16 LUFS, 58–67 s | 7–9 MB |
| Captions, one per language | `.srt`; the same lines as the captions burned into the picture | — |
| Upload sheet, one per language | title, description, chapters, tags (see *The YouTube sheet*) | — |
| Silent loop for the page, one per language | 720x680 CSS px crop, 40.5–48 s, VP9 WebM + H.264 MP4 fallback + JPG poster | ~1 MB WebM, ~0.6 MB MP4 |

The spoken and captioned words come from the extension's own `_locales/*/messages.json`. The page's
title and address and the store names on the outro card are the exceptions:

- the welcome page's steps and tips are the captions;
- its tagline is the intro;
- its subtitle is the outro.

So the video says exactly what the extension says in that language, and a translation fix in the
extension carries over to the next render.

## The pipeline

The work runs in three passes per language. Each pass is a separate process, run in the foreground.

1. **voice**: every line is voiced in takes, each take is heard back by speech recognition, and the
   best take is kept, with its length in seconds.
2. **record**: headless Chromium runs the extension's release build through a fixed scenario. Each
   scene lasts `max(planned, narration + 250 ms lead-in + 900 ms pause)`, with planned minimums
   of 3.5–6.4 s per scene. The pass saves the side panel's frames, the
   page's stills and a timeline of cursor moves, clicks and captions.
3. **render**: an HTML stage draws each frame from the timeline at time `t`, Playwright screenshots
   the stage, and ffmpeg encodes the frames. The narration clips are placed at their scenes' times.
   With `--loop`, the same timeline gives the page's silent crop.

Then two small steps follow:

- the upload sheet, built from the extension's texts and the timeline;
- a final check, where Whisper hears each finished MP4 against its `.srt`.

Voicing first matters. The scenes are timed to the narration, so the recording never has to be cut
to fit the voice.

Rough timings on one RTX 5070 laptop:

- voicing all seven languages: about 1 h 20 min;
- one recording: about a minute;
- rendering the narrated video: about 1.5x real time;
- rendering the loop: about 1x real time.

## Recording the extension

- **The side panel needs raw CDP.** Playwright's `launchPersistentContext` with the extension
  loaded does not expose the side panel's target, so Playwright cannot drive it. Run Chromium
  (Playwright's own build) directly:
  - flags: `--headless=new`, `--remote-debugging-port`, `--load-extension`,
    `--disable-extensions-except` and a temporary `--user-data-dir`;
  - list targets from `/json/list` and open a WebSocket per target (welcome page, side panel, demo
    page);
  - get the browser's own WebSocket from `/json/version`.
- **Opening the side panel takes a real user gesture.** `sidePanel.open()` needs one. A real mouse
  click on the welcome page's button works: `Input.dispatchMouseEvent`, after `scrollIntoView`,
  because the button sits below the fold in a 720-px window. The page learns its window id
  asynchronously and ignores early clicks, so retry the click until the panel's target appears.
- **The panel follows the active tab, not a navigation inside it.** Open the demo page with
  `Target.createTarget` (a new active tab), then press the panel's refresh button. The panel was
  opened on the welcome tab and may still show *that* page's code. Press refresh every time, then
  prove it worked: open the Embed tab and check that its snippet contains
  `encodeURIComponent(PAGE_URL)`. A run once recorded the welcome page's code because refresh was
  skipped when a preview already existed.
- **The panel's size comes from the window.** `Emulation.setDeviceMetricsOverride` is ignored there.
  At `--window-size=1280,720` the panel was 360x574. Adding 34 px of window height made it
  360x608. Assert the size before recording.
- **The page is two stills, not a recording.** The page does not change during the video, so it is
  two screenshots taken with a metrics override: full width before the panel opens, and the width
  beside the panel. Only the panel is recorded, with `Page.startScreencast`; every frame keeps its
  timestamp, and the renderer picks the frame for time `t`.
- **Click a visible element, and prove the click lands.** The panel keeps hidden copies of its
  controls (one per tab). The first `.btn--primary` was hidden, and its zero rectangle sent the
  drawn cursor to 0,0. The viewer noticed the miss. Two rules prevent it:
  - take the first match with a non-empty client rect;
  - before clicking, check that `document.elementFromPoint(x, y)` is that element, inside it, or its
    label. If the check fails, stop the recording instead of filming a miss.
- **A native `<select>` opens no popup in a screencast.** Draw the cursor clicking the select, then
  set its value and dispatch `input` and `change`.
- **Type with `Input.insertText`**, one character at a time with a short sleep. Typing becomes
  visible, and no keyboard layout gets in the way.
- **Clear focus rings.** A clicked button keeps a focus ring that looks like a stuck hover. Blur it,
  and move the mouse away before the screencast starts.
- **Downloads go to the run's folder**, not the user's: `Browser.setDownloadBehavior`.
- **End with a functional assertion.** The run fails unless History holds a `clx.cx/` code.
  Without that check, a recording that looks fine can show the wrong state. This check is weak:
  it would also pass on another clx.cx entry. The demo page itself is proven earlier by the Embed
  check. A next version should assert the demo page's exact address in History.
- **Stopping Chromium on Windows needs the profile directory.** The spawned `chrome.exe` hands over
  to a browser process and exits, so its pid leads nowhere and `taskkill /T` finds nothing. Stop
  every process whose command line contains the run's profile directory, then remove the profile
  (retry: files stay locked for a moment).

## Rendering

- **The browser chrome is drawn, not filmed.** An HTML stage (1280x720 CSS at device scale 1.5 =
  1920x1080) draws:
  - the window frame, the tab with the page's title and favicon, the address bar and the
    extension's toolbar icon;
  - the page still and the panel frame for `t`;
  - the cursor's eased travel, the click ripple, the zoom on the code and the caption box;
  - the intro and outro cards with the store names.

  The stage uses the site's own fonts (inlined as data URLs) and icon sprite. Every frame is a pure
  function of `t`, so a render is repeatable and any frame can be inspected alone.
- **Frames go straight to ffmpeg.** Each Playwright JPEG screenshot is piped into ffmpeg
  (`-f image2pipe -c:v mjpeg`). There are no frame files on disk, and the pipe's back-pressure is
  respected.
- **Narration:**
  - each clip is placed with `adelay` at its scene's start plus 250 ms;
  - the clips are mixed with `amix` (`normalize=0`);
  - the mix is padded to the video's length and normalised with `loudnorm` (I=−16, TP=−1.5);
  - the mix is muxed as AAC with `-movflags +faststart`.
- **Captions vs speech:** captions show the text exactly as the extension writes it, while the
  voice reads a spoken form (see *Narration*). The `.srt` follows the captions. In non-English
  videos the intro speaks only the tagline, so that language's `.srt` intro carries only the
  tagline too.
- **The loop for the page:**
  - the crop covers the panel and a strip of the page;
  - it runs from 1.4 s before the panel opens to 2.6 s after the History scene starts;
  - it has no captions, no zoom and no cards;
  - it fades 0.4 s in and out so the seam is soft;
  - encodings: VP9 CRF 38 for WebM and H.264 CRF 28 for MP4;
  - the poster is the frame at 2.6 s, with the panel open and its code shown.

## Narration

**Engine: Chatterbox Multilingual** (`chatterbox-tts` 0.1.7, Resemble AI, MIT licence, commercial
use allowed). We used the model's own voice, with no reference clip.

Why this engine:

- The rule we follow for voices excludes `lessac`-based and non-commercial ones. Under that rule,
  Piper has no voice for ru, pt-BR or tr.
- Chatterbox covers all seven languages under one licence; pt-BR is its `pt`.

Chatterbox embeds an inaudible Perth watermark in every clip. That is how the model ships, not a
defect.

**Install** (an NVIDIA RTX 50-series GPU needs CUDA 12.8 builds):

```sh
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install torch==2.7.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/cu128
# chatterbox-tts pins torch 2.6, which has no sm_120 kernels: install it without its pins…
.venv/Scripts/python -m pip install --no-deps chatterbox-tts==0.1.7
# …and its runtime dependencies by hand
.venv/Scripts/python -m pip install "numpy<2.0.0,>=1.24.0" librosa==0.11.0 s3tokenizer transformers==5.2.0 \
  diffusers==0.29.0 "resemble-perth>=1.0.0" conformer==0.3.2 safetensors==0.5.3 spacy-pkuseg pykakasi==2.3.0 \
  pyloudnorm omegaconf
.venv/Scripts/python -m pip install openai-whisper==20250625
```

Sizes:

- the venv: about 6.4 GB;
- the downloaded models: Chatterbox about 3 GB, Whisper `large-v3-turbo` 1.5 GB;
- the torch wheel in pip's cache: another 3 GB.

Delete all of it when the work is done.

**Process separation.** TTS and speech recognition run as separate Python processes, one per
batch, each loading its model once. Run them in the foreground. A background run on this machine
was killed by the system for lack of memory while other sessions were working.

The resemble-perth package prints its own line to stdout, so parse only the lines that start with
`{` as JSON.

**Spoken forms.** A voice of another language reads Latin abbreviations badly. Feed the TTS a
spoken spelling and keep the screen text as it is. Examples:

| Language | Spoken forms |
|---|---|
| ru | `SVG` → «эс-вэ-гэ», `QR` → «кью-ар», `H` → «эйч», `React` → «Риакт», `Vue` → «Вью» |
| es | `SVG` → «ese uve ge», `H` → «hache» |
| pt-BR | `SVG` → «esse vê gê», `H` → «agá» |
| tr | `SVG` → «es-ve-ge», `QR` → «ku-ar», `SVG'yi` → «es ve ge'yi» |
| de | `QR` → «Ku-Er» |

The English product name in a non-English voice also came out badly. Those intros speak only the
tagline, and the card shows the name.

**Choosing takes: the lesson that cost a re-voice.**

1. **The first rule was too weak.** We kept the first take whose character error rate (CER) against
   the text was under 6%. That let mangled words through: a sentence can lose a whole short word
   and stay under 6%. All six non-English languages had to be voiced again.
2. **The rule that replaced it:**
   - Trim each take as the video will play it, then add 80 ms of lead-in and 80 ms of tail. The
     filter is:

     ```
     silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse,<same>,areverse,adelay=80,apad=pad_dur=0.08
     ```

     Whisper then hears the clip that goes into the mix, with no long silences to invent words
     over. The clip is not yet loudness-normalised and AAC-encoded; the final check covers that.
   - Hear the take back with Whisper `turbo`, in the line's language.
   - Count the **ordinary words** of the text that the transcript lacks: a bag of words, each
     occurrence counted once. Names and letters (SVG, QR, Q, H, HTML, Markdown, React, Vue,
     snippet) are left out, since Whisper spells them its own way. In Turkish, join
     apostrophe suffixes before comparing (`Geçmiş'te` → `geçmişte`).
   - Score each take as: 1000 if its length is implausible (outside 0.5–1.7x of the spoken form's
     length at 14 characters a second), plus 10 for each missed word, plus the CER. Lowest score wins.
   - Rounds of three takes vary the seed, `cfg_weight` (default, 0, 0.3) and `temperature` (default,
     0.6). Lines with a missed word or an implausible length go another round, up to four rounds
     (12 takes).
   - A line whose text did not change keeps its clip; it is only heard again.
3. **The result.** In the re-voice under this rule, most lines kept the clip from the first
   voicing. Each non-English language needed new takes for one to three lines; English needed
   none.

**Final check.** Whisper hears each finished MP4 against everything its `.srt` says:

- en, pt-BR: no ordinary word missed. CER 0.009–0.014.
- fr: CER 0.008. One imperative heard as a near-form; one homophone plural.
- tr: CER 0.020. One word heard with a wrong consonant; "net" merged with the next word.
- ru: CER 0.040. One verb heard without its first letter.
- es: CER 0.056. The "o" in "Q o H" merged with the letters.
- de: CER 0.164. Most of it is Whisper inventing words over pauses and the quiet tail after the
  outro (mean −27 dB). One homophone spelling (`kodieren` for `codieren`).

## The YouTube sheet

One text file per language holds the following.

- **Title:** `<extension name> — <tagline>` with the tagline's final period dropped, under 100
  characters.
- **Description:**
  - first line: that language's extension page on clx.cx. YouTube shows only the first lines
    above "more", and the page links all three stores;
  - the extension's subtitle and description;
  - the three store links;
  - that language's generator page;
  - chapters.
- **Pinned comment:** the page and the three store links again, for the owner to post and pin.
- **Chapters:** YouTube requires the first at 0:00, at least three, each at least 10 s. They are
  built from the timeline, and dropped if any would be shorter.
- **Tags:** the extension page's primary phrase and anchors from `public/keywords.json`, the
  generator page's primary phrase, and the fixed tags "SVG QR Code Generator", "QR code", "SVG".
- **The `.srt` to attach**, the length, and when the outro card starts (for an end screen).

Each language is a separate upload, not one video with seven audio tracks.

## Limits

- **Nobody has listened.** Whisper hearing a word is not a native speaker accepting it.
  - Accent and naturalness in the six non-English languages are unassessed: the voice is the
    model's own, with no native reference clip.
  - The best-of-12 rule can still keep a slightly misheard word; the final check lists them.
  - Lines voiced with different `cfg_weight` or temperature share a timbre but may differ in pace.
- **Whisper invents text over silence**, as in the German tail. Read a high CER together with the
  list of missed words, not alone.
- **The phone tip in the video** uses the extension's wording ("point the camera"). The site's page
  in the same frame words it more softly.

## Lessons for the next video

1. **Voice first, then time the recording to the voice.** Never cut a narration to fit a recording.
2. **Draw the browser; record only what changes.** Stills for static pages, a screencast for the
   live part, a stage that renders any `t`.
3. **Assert the state, not the look:**
   - the code is the demo page's (the encoded URL in the snippet);
   - the panel has the expected size;
   - every click hits its element;
   - the scenario's result exists at the end.

   Each of these assertions was added after a recording that looked right but was wrong.
4. **Judge takes by missed words on the trimmed clip.** A CER threshold alone is not enough.
5. **Keep spoken forms apart from shown text.** The screen shows the product's text; the voice gets
   a pronounceable spelling.
6. **Run heavy steps in the foreground**, one model per process, and stop browsers by profile
   directory. Remove the venv, the model caches and the pip wheel when done.
