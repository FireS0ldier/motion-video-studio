# assets/

Everything in here is available to scenes by its path relative to this folder.

| Folder        | What goes in                                   | Use in a scene                                   |
| ------------- | ---------------------------------------------- | ------------------------------------------------ |
| `screens/`    | screenshots (PNG/JPG/WebP, ideally 2x)         | `g.image('screens/app.png', { x, y, w })`        |
| `recordings/` | screen recordings (MP4/MOV/WebM)               | `g.video('recordings/demo.mp4', { x, y, w })`    |
| `brand/`      | logo files (SVG preferred)                     | `brand.ts → logo: { mark: 'assets/brand/x.svg' }`|
| `audio/`      | `voiceover.wav` (auto-detected), `music.*`     | automatic; or `project.ts → audio`               |
| `sfx/`        | project sound effects (override library names) | `c.cue('my-sound', at)`                          |
| `images/`     | photos, illustrations, icons                   | `g.image('images/photo.jpg', { ... })`           |

Recordings are converted to frame sequences by `mvs assets` (runs automatically
before preview/render). Per-recording options: `demo.mp4.json` → `{ "fps": 60, "maxWidth": 2560 }`.
