# Photo Editor

My own editor for Instagram posts, stories, carousels and flyers for the clinic and Sognare, in the Cygnus Tools style. It is a Tauri desktop app for Windows and Mac with the editing done in Fabric.js. How to use every part of it is in [GUIDE.md](GUIDE.md). This file covers running it, building it and how the code is laid out.

## Starting it on Windows

Node.js and Rust are needed, the same setup the PDF reader and the Video Editor use.

1. Double-click `Start Photo Editor.bat`.
2. The first start installs the editor's parts into this folder and compiles the app, which takes several minutes. Later starts take seconds.

`Build Photo Editor.bat` makes `photo-editor.exe` in `src-tauri\target\release` and an installer in `src-tauri\target\release\bundle\nsis`. Close the editor before building since Windows locks the exe while it runs. The exe opens straight away without installing and keeps the version it was built from, so build again after new files arrive in this folder.

`node_modules` and `src-tauri\target` take about 3 GB together. Delete them any time since the next start rebuilds them.

## The Mac version

GitHub builds the Mac version since it can only be made on a Mac. The workflow in `.github/workflows/build.yml` runs on every push to main and makes three files: the Windows installer, a Mac app for Apple Silicon (M1 and newer) and a Mac app for older Intel Macs. To make new ones by hand, open the repository on github.com, click Actions, click Build, then Run workflow. The files are under Artifacts at the bottom of the run's page after about 15 minutes.

The Mac app needs macOS 12 or newer. It is not signed with an Apple developer account ($99 a year), so the first open needs Open Anyway in System Settings under Privacy & Security. The app shows Cmd and Option in its labels on a Mac.

## Models

- **Background removal:** the ISNet general-use model (179 MB, Apache 2.0) downloads from the rembg releases on GitHub the first time Remove background or Select subject is used, and stays in the app's data folder. It runs on the graphics card through WebGPU, or on the CPU when WebGPU is not there.
- **Upscale:** Real-ESRGAN general x4v3 (4.9 MB, BSD 3-Clause) ships inside the app as `public/models/upscale-x4.onnx`. It was converted from the original `realesr-general-x4v3.pth` release weights.

## Print colours

CMYK PDFs are converted with LittleCMS through one of two ECI press profiles in `public/icc`: ISO Coated v2 (FOGRA39) for coated paper and PSO Uncoated ISO12647 (FOGRA47) for uncoated. The European Color Initiative makes both free to use and share. The profile goes into the PDF as its output intent, which print shops check. Pantone colours are not included since Pantone licenses its colour books.

## Camera RAW

RAW files are decoded with LibRaw (libraw-wasm) using the camera's white balance, and the decoded photo is kept in the design as a PNG. LibRaw is under the LGPL, which matters only if the editor is ever sold.

## Other parts

- **Icons:** Lucide (ISC) and Simple Icons (CC0), packed into `src/icon-data.json` by `npm run icons`. Brand logos stay the trademarks of their owners.
- **QR codes:** the encoder from the Cygnus Tools Post maker.
- **WebP on a Mac:** Safari cannot write WebP, so the app uses the jSquash WebP encoder (Apache 2.0) there.
- **Interface fonts:** Cinzel and IBM Plex Sans (both OFL) through Fontsource.

## Checking the text

`node scripts/lint-strings.mjs src/*.js README.md GUIDE.md` flags the writing shapes I don't want in the app or the docs: dashes, "That is" glosses, split contrasts, filler words and reassurance clauses.

## Code

| File | Contents |
| --- | --- |
| `src/main.js` | Layout, left panels, top bar, dialogs, export, keys, clipboard, autosave |
| `src/canvas.js` | Fabric canvas, page drawing, zoom and pan |
| `src/objects.js` | Adding text, shapes, frames and photos, locking, grouping, arranging |
| `src/frames.js` | Photo crop handles, frames and crop mode |
| `src/props.js` | Right-hand settings panel |
| `src/layers.js` | Layers panel: blend, opacity, clip, mask, merge |
| `src/selection.js` | Select tab: selection tools, Select subject, marching ants, copy, cut, hide, fill, saved selections, text behind subject |
| `src/layerfx.js` | How masks, clipping, warp, outline and glow are drawn, and flattening layers |
| `src/maskpaint.js` | Paint mask and Fade out |
| `src/retouch.js` | Retouch editor: spot heal and clone |
| `src/upscale.js`, `src/upscale-worker.js` | Upscale with Real-ESRGAN |
| `src/eyedropper.js` | Picking a colour from the page |
| `src/textstyles.js` | Saved text styles |
| `src/qrcode.js`, `src/qr.js` | QR code objects and the encoder |
| `src/icons.js` | Icon library |
| `src/layouts.js` | Other sizes, panorama carousel, before-and-after layouts |
| `src/rulers.js` | Rulers, guides, story safe zone, slide edges |
| `src/mac.js` | Cmd and Option labels on a Mac |
| `src/guides.js` | Snapping, align and distribute |
| `src/fonts.js` | Installed and added fonts, font picker |
| `src/brand.js` | Brand kits |
| `src/templates.js` | Templates panel |
| `src/pages.js` | Pages, switching, resizing the design |
| `src/history.js` | Undo and redo |
| `src/project.js` | Reading and writing the .zip design file |
| `src/exporter.js` | Rendering pages, PNG, JPG and WebP, file size limit, watermark, PDF |
| `src/bgremove.js`, `src/bg-worker.js` | Background model and the cut-out maths |
| `src/refine.js` | Cut-out editor |
| `src/adjust.js`, `src/adjustpanel.js` | Photo adjustments, Looks, curves, levels, colour grading |
| `src/draw.js` | Draw panel and brushes |
| `src/batch.js` | Batch export |
| `src/color.js` | CMYK conversion, print preview and CMYK PDF |
| `src/raw.js` | Camera RAW decoding |
| `src/home.js` | Start screen, recent designs, shortcut list |
| `src/platform.js` | File access through the Rust side |
| `src-tauri/src/lib.rs` | Rust commands for files, fonts and the model download |
