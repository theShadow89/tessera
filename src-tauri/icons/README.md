# App icons

Icons are **generated, not committed**. The source is `../app-icon.png` (a
1024×1024 placeholder — replace it with the real logo).

Generate them from the source before a local desktop build:

```bash
npx tauri icon src-tauri/app-icon.png
```

This writes `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`, and platform variants into this folder, matching the paths listed in
`../tauri.conf.json` under `bundle.icon`. The Release workflow
(`.github/workflows/release.yml`) runs this step automatically, so CI builds
need no committed icons. `tauri dev` runs without them; `tauri build` requires
them.

The generated files are git-ignored (see `../.gitignore`).
