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
- **Faces:** face-api (@vladmandic/face-api, MIT) finds faces and 68 points on each, with its SSD MobileNet and 68-point landmark models in `public/models/face` (6 MB). Faces are straightened to the FFHQ 512 layout the same way CodeFormer does it, worked on, and pasted back through a soft oval.
- **Bodies:** MoveNet Thunder (Google, Apache 2.0), as converted to TensorFlow.js in @vladmandic/human-models (MIT), in `public/models/pose` (12 MB). It finds 17 body points, and Before and after lines up body photos by the shoulders, elbows, hips and knees with a least-squares fit.
- **Enhance faces:** RestoreFormer++ (Apache 2.0), converted from the facefusion ONNX export: debug outputs removed, simplified and stored as fp16 (148 MB). It downloads the first time Enhance faces or Glow up runs, from the `models` branch of this repo in two parts, with the facefusion fp32 file as the fallback. It was trained on FFHQ, whose photos are under their own licences, which matters only if the editor is ever sold. CodeFormer was studied for the method but not used, since its S-Lab licence rules out commercial use.
- **Upscale:** Real-ESRGAN general x4v3 (4.9 MB, BSD 3-Clause) ships inside the app as `public/models/upscale-x4.onnx`. It was converted from the original `realesr-general-x4v3.pth` release weights.

## Print colours

CMYK PDFs are converted with LittleCMS through one of two ECI press profiles in `public/icc`: ISO Coated v2 (FOGRA39) for coated paper and PSO Uncoated ISO12647 (FOGRA47) for uncoated. The European Color Initiative makes both free to use and share. The profile goes into the PDF as its output intent, which print shops check. Pantone colours are not included since Pantone licenses its colour books.

## Camera RAW

RAW files are decoded with LibRaw (libraw-wasm) using the camera's white balance, and the decoded photo is kept in the design as a PNG. LibRaw is under the LGPL, which matters only if the editor is ever sold.

## Borrowed methods

The layout follows PhotoCraft (github.com/storytold/photocraft), an open-source copy of Photoshop. Exposure, highlights and shadows, whites and blacks, vibrance, clarity, texture, dehaze, the colour mixer, noise reduction, grain, auto tone, red eye and the gradient masks follow the methods in LightCraft (github.com/storytold/lightcraft). Combining shapes, text on a path and repeat follow VectorCraft, data merge and preflight follow DesignCraft, and edge pins and spacing labels follow FigCraft. All of them are Rust apps by Storyteller under MIT or Apache 2.0, so none of their code is here. The methods were rewritten in JavaScript. The ArtCraft name and logos belong to Storyteller and are not used.

Shape combining uses polygon-clipping (MIT).

## Other parts

- **Icons:** Lucide (ISC) and Simple Icons (CC0), packed into `src/icon-data.json` by `npm run icons`. Brand logos stay the trademarks of their owners.
- **QR codes:** the encoder from the Cygnus Tools Post maker.
- **WebP on a Mac:** Safari cannot write WebP, so the app uses the jSquash WebP encoder (Apache 2.0) there.
- **Interface fonts:** Cinzel and IBM Plex Sans (both OFL) through Fontsource.

## Claude connector

`mcp/photo-editor-mcp.mjs` is an MCP server with no packages, started by the Claude desktop app with `node`. It reads `mcp.json` from the app data folder for the port and token, then sends each tool call to `POST http://127.0.0.1:<port>/rpc`. `src-tauri/src/bridge.rs` runs that server only while Help > Let Claude control this app is ticked. It binds to 127.0.0.1, makes a new random token on each start, refuses requests with a wrong token or an `Origin` header, and hands each request to the editor window as an `mcp-request` event. `src/mcp.js` runs the tool and answers through `mcp_reply`. The connector splits batch_retouch and batch_before_after into a few photos per call so none runs past the five-minute wait in `bridge.rs`, and sends MCP progress between them. Its instructions tell any Claude using it how to handle groups of photos and that treatment results stay unedited. The setup steps are in GUIDE.md under Letting Claude edit for you.

## Checking the text

`node scripts/lint-strings.mjs src/*.js README.md GUIDE.md` flags the writing shapes I don't want in the app or the docs: dashes, "That is" glosses, split contrasts, filler words and reassurance clauses.

## Code

| File | Contents |
| --- | --- |
| `src/main.js` | Layout, library panels, files, export, clipboard, the core commands, keys, autosave |
| `src/faces.js` | Face finding, the 68 points, straightening to 512 and pasting back |
| `src/beauty.js` | Smooth skin, Slim face, Slim body, Bright eyes, Whiten teeth and Enhance faces, kept editable on each photo |
| `src/face-worker.js` | Runs RestoreFormer++ off the main thread |
| `src/quickfix.js` | Quick fixes buttons, Fine tune sliders, Glow up's light and colour, the Image > Quick fixes commands |
| `src/beforeafter.js` | Before and after from two photos with the faces lined up, and Touch up |
| `src/pose.js` | Body points with MoveNet, for lining up body photos |
| `src/defaults.js` | The Save as default settings that new files and Claude's batches start from |
| `src/badge.js` | Label and tag layers (BEFORE, SIMULATED GOAL) whose words and colours stay editable |
| `src/pixels.js` | Fast blurs and mask helpers for the retouch tools |
| `src/mcp.js` | The Claude connector's tools and the Help menu switch |
| `src/menus.js` | The menu bar, in Photoshop's order |
| `src/commands.js` | Command list, menus, shortcuts and command search |
| `src/tools.js` | Tool column, options bar, colours, what each tool does on the page |
| `src/dock.js` | Right-hand panels and the History panel |
| `src/canvas.js` | Fabric canvas, page drawing, zoom and pan |
| `src/objects.js` | Adding text, shapes, frames and photos, locking, grouping, arranging |
| `src/frames.js` | Photo crop handles, frames and crop mode |
| `src/props.js` | Properties panel |
| `src/layers.js` | Layers panel: blend, opacity, clip, mask, merge |
| `src/selection.js` | Selection tools, Select subject, colour range, marching ants, copy, cut, hide, fill, saved selections, text behind subject |
| `src/layerfx.js` | How masks, clipping, warp, layer styles and distort are drawn, and flattening layers |
| `src/layerstyles.js` | Layer style commands |
| `src/transform.js` | Distort, perspective and skew |
| `src/adjust.js` | The photo adjustment pass, auto tone, histogram |
| `src/adjustpanel.js` | The adjustment controls for photos and adjustment layers |
| `src/adjustlayers.js` | Adjustment layers and the Adjustments panel |
| `src/develop-ui.js` | Auto, copy and paste adjustments, colour range |
| `src/lut.js`, `src/luts.js` | .cube colour lookups and the built-in film looks |
| `src/shapetools.js`, `src/shapeops.js` | Shape outlines, combining shapes, text on a shape, repeat |
| `src/patterns.js` | Pattern fills |
| `src/preflight.js` | Check design and edge pins |
| `src/maskpaint.js` | Paint mask, Fade out and Radial |
| `src/retouch.js` | Retouch editor: spot heal, clone and red eye |
| `src/upscale.js`, `src/upscale-worker.js` | Upscale with Real-ESRGAN |
| `src/eyedropper.js` | Picking a colour from the page |
| `src/textstyles.js` | Saved text styles |
| `src/qrcode.js`, `src/qr.js` | QR code objects and the encoder |
| `src/icons.js` | Icon library |
| `src/layouts.js` | Other sizes, panorama carousel, before-and-after layouts |
| `src/rulers.js` | Rulers, guides, story safe zone, slide edges |
| `src/mac.js` | Cmd and Option labels on a Mac |
| `src/guides.js` | Snapping, spacing labels, align and distribute |
| `src/fonts.js` | Installed and added fonts, font picker |
| `src/brand.js` | Brand kits |
| `src/templates.js` | Templates panel |
| `src/pages.js` | Pages, switching, resizing the design |
| `src/history.js` | Undo, redo and step names |
| `src/project.js` | Reading and writing the .zip design file |
| `src/exporter.js` | Rendering pages, PNG, JPG and WebP, file size limit, watermark, PDF |
| `src/bgremove.js`, `src/bg-worker.js` | Background model and the cut-out maths |
| `src/refine.js` | Cut-out editor |
| `src/draw.js` | Brush |
| `src/batch.js` | Batch export and spreadsheet posts |
| `src/color.js` | CMYK conversion, print preview and CMYK PDF |
| `src/raw.js` | Camera RAW decoding |
| `src/home.js` | Start screen, recent designs |
| `src/platform.js` | File access through the Rust side |
| `src-tauri/src/lib.rs` | Rust commands for files, fonts and the model download |
| `src-tauri/src/bridge.rs` | Local server for the Claude connector |
| `mcp/photo-editor-mcp.mjs` | The Claude connector |
