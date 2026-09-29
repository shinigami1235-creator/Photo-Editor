# Photo Editor guide

Photo Editor makes Instagram posts, stories, carousels, Facebook covers and printed flyers on your own computer. It runs on Windows and on Mac, and it works offline once the background model has downloaded. This guide follows the order you would use it in: install it, start a design, add and edit things, then export. The shortcuts are listed at the end.

## Installing it

GitHub builds the installers from the code in shinigami1235-creator/Photo-Editor. You need a free GitHub account to download them.

1. Open github.com/shinigami1235-creator/Photo-Editor and click Actions.
2. Click the newest Build with a green tick.
3. Scroll to Artifacts at the bottom and download Photo Editor for Windows or Photo Editor for Mac.

### Windows

1. Unzip the download and double-click the file ending in `x64-setup.exe`.
2. Windows shows "Windows protected your PC" since the app is not signed. Click More info, then Run anyway.
3. Photo Editor is added to the Start menu.

### Mac

1. Unzip the download. It holds two files: `aarch64` is for Apple Silicon Macs (M1 and newer) and `x64` is for older Intel Macs. Apple menu > About This Mac says which one you have.
2. Open the .dmg and drag Photo Editor into Applications.
3. The first open is blocked since the app is not signed with an Apple developer account. Open System Settings > Privacy & Security, scroll down and click Open Anyway next to Photo Editor.
4. If the Mac says the app is damaged, open Terminal and run `xattr -cr "/Applications/Photo Editor.app"`, then open it again.

It needs macOS 12 or newer. On a Mac, every shortcut in this guide uses Cmd in place of Ctrl and Option in place of Alt, and the app shows them that way.

## Starting a design

The start screen shows when the app opens. Click the logo at the top left to get back to it.

- **New design:** Instagram post 4:5, Instagram post 1:1, Story 9:16, Facebook cover, A4 flyer at 300 dpi, or Custom size.
- **Panorama carousel:** one wide page cut into 2 to 10 slides on export, so a photo or a line runs across the swipe. Pick the number of slides and the slide shape.
- **Open design or picture:** design files (.zip), PNG, JPG, WebP and camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and more). A picture opens as a new design at its own size.
- **Recent designs:** the last 12 designs you saved or opened.

You can also drag pictures from File Explorer or Finder onto the page, or paste a screenshot with Ctrl+V.

## The screen

- **Top bar:** New, Open, Save, Save as, undo and redo, zoom, snapping (the magnet), rulers, the shortcut list (?) and Export.
- **Left tabs:** Text, Photos, Shapes, Frames, Select, Draw, Brand, Templates and Layers.
- **Right panel:** settings for whatever is selected. With nothing selected it shows the page: name, size, view settings and background colour.
- **Bottom strip:** the pages of the design. Click + to add one, and use the buttons on the right to duplicate or delete the current page.

Scroll to move around the page. Hold Ctrl and scroll to zoom, or hold Space and drag.

## Text

1. Open the Text tab and click Add a heading or Add body text.
2. Double-click the text to type.
3. Change the font, size, bold, italic, underline, alignment, letter spacing and line height on the right.

- **Fill:** Solid, Linear or Radial. A gradient takes two colours and an angle.
- **Curve:** bends one line of text into an arch. Negative values make a smile.
- **Outline:** a stroke around the letters.
- **Add font file:** in the Text tab, for any TTF, OTF or WOFF font you have. It stays in the app for later designs.

### Text styles

Save a text look you want to reuse, such as a clinic heading or a price tag.

1. Select a text and click Save as text style at the bottom of its settings.
2. Name it.
3. Click the style in the Text tab to apply it to the selected text, or to add a new heading with it when nothing is selected. Right-click a style to delete it.

A style keeps the font, size, colour or gradient, outline, shadow, glow and warp.

## Photos and frames

- **Add photos:** in the Photos tab. Click a photo to put it on the page, or drag it onto a frame.
- **Crop:** pull a side handle of the photo. Double-click the photo to move and zoom it inside its frame, then press Enter.
- **Shape:** rectangle, rounded, arch or circle, under Photo on the right.
- **Rotate photo and Flip photo:** turn the picture while the frame stays still.
- **Frames:** empty shapes in the Frames tab that take a photo dropped onto them.

### Adjusting a photo

Under Adjust on the right:

- **Looks:** None, Vivid, Warm, Cool, Golden, Film, Fade, B&W, Sepia, Noir, Soft skin and Crisp.
- **Sliders:** brightness, contrast, saturation, warmth, tint, fade, vignette, sharpen and blur.
- **Curves and levels:** drag the curve up to brighten the midtones. Levels set the black point, midtones and white point.
- **Colour grading:** one colour for the shadows and one for the highlights, each with its own amount.

Reset all puts the photo back.

## Background removal

1. Click the photo and press Remove background.
2. Drag a box around the person or product so the model only looks inside it. Leave it empty to use the whole picture.
3. Press Remove background. The first time downloads the background model (179 MB).
4. Fix what it got wrong with Brush (B), Wand (W) or Lasso (L). Erase (E) and Restore (R) switch what the brush and wand do.
5. Press Apply, or Apply as new photo to keep the original underneath.

- **Brush and Wand:** only change colours close to the colour where the stroke starts, within Tolerance. A stroke that spills onto the subject leaves it alone.
- **Lasso:** keeps what you draw around. Hold Shift for the next outline to keep that too. Invert selection (Ctrl+Shift+I) removes what is inside instead.

Edit cut-out reopens the editor with every step kept. Restore background puts the original back.

## Retouch

Click a photo and press Spot heal and clone.

- **Spot heal (J):** paint over a spot, a stray hair or dust. It fills from the area around it and matches the light when you let go.
- **Clone (S):** Alt+click the spot to copy from, then paint where it should go. The gold cross shows where it is copying from.

[ and ] change the brush size. Ctrl+Z undoes a stroke. Press Apply when done. Keep both tools off treatment results in before-and-after photos, since an edited result is the first thing people call out.

## Upscale

Upscale 2× and Upscale 4× under Retouch make a small or old photo sharp enough for a bigger post or for print. The photo stays the same size on the page with more pixels in it. The result can be up to 8192 pixels wide. It takes a few seconds with a graphics card and up to a minute without one.

## Selections

The Select tab (S) selects part of the page, the way Photoshop does.

1. Pick the layer to work on under Layer, or All layers.
2. Pick a tool: Rectangle or Ellipse (M), Lasso or Polygon (L), or Wand (W).
3. Drag on the page. Hold Shift to add to the selection and Alt to subtract.

- **Polygon:** click each corner, then click the first point, double-click or press Enter to close it.
- **Wand:** clicks a colour and takes the area around it. Tolerance sets how far the colour can drift. Untick Connected area only to take that colour everywhere. Look at picks this layer or all layers.
- **Select subject:** finds the person or product on the chosen layer with the background model.
- **From layer:** selects the shape of a layer. Ctrl+click a layer's icon in Layers does the same.
- **Invert (Ctrl+Shift+I), Expand, Contract and Feather:** change the selection. Edge by sets the pixels.

The selection stays when you pick another layer, so the same area works on any layer.

### Using a selection

- **Copy to new layer (Ctrl+J):** puts the selected part on a layer of its own. With All layers picked it copies everything you see.
- **Cut to new layer (Ctrl+Shift+J):** the same, and hides that area on the original.
- **Hide area (Delete):** hides the selected area of the layer with a mask.
- **Keep only area:** hides everything else.
- **Show area again:** brings a hidden area back.
- **Fill as new layer:** fills the selection with the colour next to it.
- **Save selection:** keeps it with the page. Click it later to load it again. It is saved in the design file.

Press Esc or Ctrl+D to deselect. Ctrl+Z undoes selection changes while the last thing you did was a selection.

## Layers

The Layers tab lists everything on the page with the front at the top. Drag a row to reorder it, double-click to rename it, and use the lock and eye buttons to lock or hide it.

- **Blend mode and opacity:** above the list, for the chosen layer. Multiply, Screen, Overlay, Soft light and the rest work the way they do in Photoshop.
- **Duplicate:** copies the layer.
- **Clip:** shows the layer only inside the layer below it, such as a photo inside big text.
- **Add mask:** keeps the selected area and hides the rest when you have a selection, or adds an empty mask to paint on.
- **Merge down:** flattens the layer into the one below. With several layers selected it says Merge and flattens them all.
- **Group:** with several layers selected.
- **Delete:** removes the layer.

A layer with a mask shows a mask tag. Click it to turn the mask off and on.

### Painting a mask

Click a layer and look under Layer on the right.

- **Paint mask:** a soft brush. Hide (X) paints parts away and Show (X) brings them back. Size and Softness are in the bar at the top of the page.
- **Fade out:** drag across the layer from where it should stay to where it should disappear. A photo fading into the background is the usual use.

Press Done or Enter to keep it, or Cancel or Esc to throw it away. Invert mask, Select shape and Delete mask are under Layer too.

## Effects

Under Effects for any layer:

- **Opacity, Blend and Shadow.**
- **Outline:** a line around the shape of the layer, which suits cut-outs and text.
- **Glow:** a soft colour around the layer, with size and strength.

Under Warp, pick Arc, Arch, Bulge, Flag, Wave or Rise and move Bend both ways. Warp bends text, photos and shapes.

### Text behind the subject

1. Click a photo of a person or product.
2. Press Text behind subject under Background.
3. The app copies the subject to a layer in front, then puts your text between the photo and that copy. With no text above the photo it adds a big heading.
4. Type over the heading and drag it into place.

## Shapes, icons and QR codes

The Shapes tab has rectangle, rounded, circle, triangle and line, plus:

- **QR code:** type a link. Change the link, the colours and the error correction on the right. Dark squares on a light background scan best, so test it with your phone before printing.
- **Icons:** 2118 line icons and 30 social and payment logos such as Instagram, Facebook, Messenger, WhatsApp, TikTok, Viber, Shopee, Grab, foodpanda, Visa and PayPal. Search by name, such as phone, clock, gift or map. Change the colour and line width on the right.

## Drawing

Press B or open the Draw tab. Pick Pen, Marker, Highlighter or Spray, the colour, size and opacity. Each stroke is its own object you can move or delete. Press Esc to stop drawing.

## Brand kits and the eyedropper

The Brand tab keeps colours, a heading font, a body font and logos for each brand, such as Cygnus Aesthetics and Sognare.

- **Colours:** click + to add one. Click the pipette to pick a colour from the page. Right-click a colour to remove it.
- **Fonts:** new text uses the kit's heading and body fonts.
- **Logos:** click one to add it to the page.

Every colour setting on the right has a pipette too. Click it, then click anywhere on the page to use that colour. Esc cancels.

## Templates and before-and-after

- **Before and after:** Side by side, Top and bottom, and Split. Each has two frames of the same size with BEFORE and AFTER labels. It fills an empty page, or goes on a new page after the current one. Drop a photo on each frame.
- **Save page as template:** keeps the current page. Click a template to add it as a new page.

## Rulers, guides and the safe zone

- **Rulers (Ctrl+R):** along the top and left of the page, in page pixels.
- **Guides:** drag from a ruler onto the page. Drag the small marker on the ruler to move a guide, or drag it back onto the ruler to remove it. Objects snap to guides. Clear guides is in the page settings.
- **Story safe zone:** in the page settings under View. It shades the top and bottom of the page where Instagram covers a story with its own buttons. Keep text inside the dashed box.

A panorama carousel shows where each slide starts, and objects snap to the slide edges.

## Pages and other sizes

A design can hold several pages, such as the slides of a normal carousel. Each page exports as its own file.

Make other sizes in the page settings copies the whole design to any of the other sizes, with the text, logos and photos moved to fit. Each size is saved as its own design file in a folder you pick. Open each one and adjust it before exporting.

Resize in the page settings changes the size of this design and scales the content to fit.

## Exporting

Click Export at the top right.

- **Format:** PNG, JPG, WebP or PDF.
- **Size:** 1× or 2×.
- **Quality:** for JPG and WebP.
- **Keep each file under:** for JPG and WebP. The quality steps down until the file fits, which helps for WhatsApp and websites.
- **Transparent background:** for PNG and WebP.
- **Split into slides:** for a panorama carousel. The slides save as numbered files in order.
- **Watermark:** a logo from your brand kits and a line of text, such as your Instagram handle, in the corner you pick. Set its size and opacity while watching the preview. The settings are remembered.
- **PDF:** RGB, or CMYK for print with the paper profile the print shop uses. Preview print colours shows the page as it will print and can mark colours ink cannot reach.

With several pages or slides, pick a folder and the files save as the design name with -01, -02 and so on.

### Batch export

Batch export in the Export dialog makes one picture per row, such as the same post with different prices or photos.

1. Tick the texts and photos that change.
2. Fill one row per version, or press Paste rows and paste from Excel.
3. Fill the photo column from a set of files if the photos change.
4. Press Export all.

Tick Watermark to use the watermark set in Export.

## Saving

Save and Save as write a design file (.zip) with the photos, masks, saved selections, guides and added fonts inside it. Everything stays editable when you open it again. The app also saves a copy every few seconds, and after a crash it offers to restore the design you were working on.

## Shortcuts

| Keys | Action |
| --- | --- |
| Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S | New, open, save, save as |
| Ctrl+E | Export |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste |
| Ctrl+D or Ctrl+J | Duplicate. With a selection, Ctrl+D deselects and Ctrl+J copies the selected part |
| Ctrl+Shift+J | Cut the selected part to a new layer |
| Ctrl+Shift+I | Invert the selection |
| Ctrl+G, Ctrl+Shift+G | Group, ungroup |
| Ctrl+A | Select all. In the Select tab it selects the whole page |
| Ctrl+L | Lock or unlock |
| Ctrl+] and Ctrl+[ | Forward, backward. Add Shift for front and back |
| Ctrl+R | Rulers |
| Ctrl+0, Ctrl+1 | Fit to screen, actual size |
| Arrow keys | Nudge 1 px, or 10 px with Shift |
| Delete | Delete. With a selection it hides that area |
| Enter | Edit the selected text, or crop the selected photo |
| T, R, O, L, F | Add text, rectangle, circle, line, frame |
| B | Draw |
| S | Select tab. Inside it M, L and W switch tools |
| Shift, Alt while selecting | Add to, subtract from the selection |
| Esc | Deselect, or leave the Draw or Select tab |
| X, [ and ] while painting a mask | Switch Hide and Show, brush size |
| J, S in Retouch | Spot heal, Clone |
| Space + drag, middle mouse drag | Pan |
| Ctrl + mouse wheel | Zoom |
| Alt while dragging | Move without snapping |
| ? | Shortcut list |

## Where things are kept

| What | Windows | Mac |
| --- | --- | --- |
| Brand kits, fonts, templates, text styles, recent designs, autosave and settings | `%APPDATA%\com.cygnussolutions.photoeditor` | `~/Library/Application Support/com.cygnussolutions.photoeditor` |
| Background model (179 MB) | `models` inside the same folder | `models` inside the same folder |
| Designs | wherever you save them, as .zip files | wherever you save them, as .zip files |

Send Claude a screenshot if anything in this guide does not match what you see.
