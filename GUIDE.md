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

The start screen shows when the app opens. Click the logo at the top left, or File > Start screen, to get back to it.

- **New design:** Instagram post 4:5, Instagram post 1:1, Story 9:16, Facebook cover, A4 flyer at 300 dpi, or Custom size.
- **Panorama carousel:** one wide page cut into 2 to 10 slides on export, so a photo or a line runs across the swipe. Pick the number of slides and the slide shape.
- **Open design or picture:** design files (.zip), PNG, JPG, WebP and camera RAW files (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2 and more). A picture opens as a new design at its own size.
- **Recent designs:** the last 12 designs you saved or opened.

You can also drag pictures from File Explorer or Finder onto the page, or paste a screenshot with Ctrl+V.

## The screen

The layout follows Photoshop, so anything learned there works here.

- **Menu bar:** File, Edit, Image, Layer, Type, Select, Filter, View, Window and Help. Every command in the app is in a menu with its shortcut beside it.
- **Search (Ctrl+F or the magnifier at the top right):** type part of a command's name, such as "curves" or "shadow", and press Enter to run it.
- **Options bar:** under the menus. It shows the settings of the tool you are using, plus undo and redo on the right.
- **Tools:** the column on the left. Hover a tool to see its key. A tool with a small corner triangle has more tools behind it, so right-click it or hold the mouse on it to pick one.
- **Colours:** the two squares under the tools. The front one is the foreground colour, used by new shapes, text, the brush and Fill. Click a square to change it. X swaps them and D sets black and white.
- **Photos, Shapes, Text, Templates and Brand:** the buttons at the bottom of the tool column open a panel of things to add next to the page. Click the same button again to close it.
- **Panels on the right:** Properties and Adjustments on top, Layers and History below. Drag the bar between them to give one more room. The icons beside the panels bring each one forward, and the arrow at the bottom hides them all (Shift+Tab).
- **Page strip:** the pages of the design along the bottom. View > Page strip hides it.
- **Status bar:** zoom, design size, page, layer count and the last message. Type a zoom percentage into its box, or use the magnet to turn snapping off.

Scroll to move around the page. Hold Ctrl and scroll to zoom, or hold Space and drag with any tool.

## Tools

| Tool | Key | Use |
| --- | --- | --- |
| Move | V | Select layers, drag them, resize them. The options bar has align, arrange, flip and lock |
| Rectangle and ellipse select | M | Drag to select an area. Press M again to switch between the two |
| Lasso and polygon lasso | L | Draw around an area. Press L again to switch |
| Magic wand | W | Click a colour to select the area around it |
| Crop | C | Click a photo to crop it inside its frame |
| Eyedropper | I | Click the page to pick the foreground colour. Alt+click picks the background colour |
| Spot heal and clone | J | Click a photo to open Retouch |
| Brush | B | Draw strokes in the foreground colour |
| Text | T | Click to add text, or drag to set its width. Click a text to edit it. Esc finishes |
| Shape | U | Drag to draw a rectangle, rounded rectangle, circle, triangle, line, star, polygon, badge, arrow, heart, speech bubble or plus. Hold Shift to keep it even |
| Frame | K | Drag to draw a frame for a photo |
| Hand | H | Drag to move around the page |
| Zoom | Z | Click to zoom in, Alt+click to zoom out |

After drawing a shape or frame the app goes back to the Move tool with the new layer selected.

## Text

1. Pick the Text tool (T) and click the page, or open Text at the bottom of the tool column and click Add a heading or Add body text.
2. Type the text.
3. Change the font, size, bold, italic, underline, alignment, letter spacing and line height under Properties.

- **Fill:** Solid, Linear, Radial or Pattern. A gradient takes two colours and an angle.
- **Curve:** bends one line of text into an arch. Negative values make a smile.
- **Put text on a shape (Type menu):** select a text and a shape together with Shift+click, then pick Type > Put text on a shape. The text runs around the shape's outline, such as a circle badge. Type > Take text off its path straightens it again.
- **Add font file:** in the Text panel, for any TTF, OTF or WOFF font you have. It stays in the app for later designs.

### Text styles

Save a text look you want to reuse, such as a clinic heading or a price tag.

1. Select a text and click Save as text style at the bottom of its settings.
2. Name it.
3. Click the style in the Text panel to apply it to the selected text, or to add a new heading with it when nothing is selected. Right-click a style to delete it.

A style keeps the font, size, colour or gradient, outline, shadow, glow and warp.

## Photos and frames

- **Add photos:** in the Photos panel, or File > Place photo (Shift+Ctrl+P). Click a photo in the panel to put it on the page, or drag it onto a frame.
- **Crop:** pull a side handle of the photo, or use the Crop tool (C) to move and zoom it inside its frame. Press Enter when done.
- **Shape:** rectangle, rounded, arch or circle, under Photo in Properties.
- **Rotate photo and Flip photo:** turn the picture while the frame stays still.
- **Frames:** in the Shapes panel or with the Frame tool (K). Drop a photo on one to fill it.

Properties warns when a photo is shown bigger than its own pixels, since it will look soft. Upscale 2× under Retouch fixes most of them.

## Adjusting a photo

Select a photo and look under Adjust in Properties. The histogram at the top shows the light in the photo, and the numbers under it say how much is pure black and pure white. A blue or red corner lights up when more than half a percent is lost to black or white.

- **Auto:** sets the light and colour for you (Shift+Ctrl+L for light only, Shift+Ctrl+B for colour only).
- **Copy and Paste:** copy one photo's settings and paste them onto other photos so a set of posts matches (Shift+Ctrl+C and Shift+Ctrl+V).
- **Looks:** None, Vivid, Warm, Cool, Golden, Film, Fade, B&W, Sepia, Noir, Soft skin and Crisp.
- **Light:** exposure, contrast, brightness, highlights, shadows, whites and blacks. Highlights brings back a bright sky and Shadows opens up dark faces without flattening the photo.
- **Colour:** warmth, tint, vibrance and saturation. Vibrance boosts dull colours more than strong ones and goes easy on skin.
- **Colour mixer:** hue, saturation and luminance for eight colours, such as making a blue sky deeper or orange skin softer. Tick Black and white to turn the photo grey and use the same sliders to make each colour lighter or darker in grey.
- **Effects:** clarity, texture, dehaze, vignette, grain and fade. Clarity adds punch to the midtones, texture sharpens fine detail such as fabric, and dehaze cuts through haze or adds it with negative values.
- **Detail:** sharpen, noise reduction and colour noise for dark or phone photos.
- **Blur:** blur, motion blur with its angle, tilt-shift with where the sharp band sits and how wide it is, and pixelate.
- **Curves and levels:** drag the curve up to brighten the midtones. Levels set the black point, midtones and white point.
- **Colour grading:** one colour for the shadows and one for the highlights, each with its own amount.
- **Photo filter:** a coloured glass over the lens, such as Warming or Cooling, with its density.
- **Colour lookup:** six built-in film looks, or a .cube file from Premiere, DaVinci Resolve or a LUT pack. Amount mixes it with the photo. A .cube file can also be dropped on the page.

Double-click a slider to put it back to zero. Reset puts the whole photo back. A big photo shows a faster preview while a slider moves and the full result when you let go.

The Image > Adjustments menu and the Filter menu open the same settings on the selected photo. With nothing selected they add an adjustment layer instead.

## Adjustment layers

An adjustment layer changes every layer below it and leaves them as they are, the way Photoshop's do. Open the Adjustments panel and click one, or use Layer > New adjustment layer.

- Brightness and contrast, Levels, Curves, Exposure, Vibrance, Colour mixer, Colour grading, Black and white, Photo filter, Colour lookup, Clarity and dehaze, and Blur. Each one opens the matching section, and every other section works on it too.
- **Move it in Layers** to change what it covers. Only the layers under it change.
- **Only the layer below:** limits it to the one layer right under it, such as warming one photo.
- **Paint mask, Fade and Radial:** limit it to part of the page. Radial is a circle that keeps the middle and fades out, which suits a spotlight on a product. Tick Fade the middle instead for the opposite.
- **Opacity and Blend:** turn it down, or blend it like any other layer.

Photo filters in the Adjustments panel and the Filter menu work the same way: on the selected photo if there is one, otherwise as an adjustment layer over the page.

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

Click a photo with the Spot heal tool (J), or press Spot heal and clone in Properties.

- **Spot heal (J):** paint over a spot, a stray hair or dust. It fills from the area around it and matches the light when you let go.
- **Clone (S):** Alt+click the spot to copy from, then paint where it should go. The gold cross shows where it is copying from.
- **Red eye (E):** click each red pupil with the circle a little bigger than the eye. Only the red inside the circle turns dark.

[ and ] change the brush size. Ctrl+Z undoes a stroke. Press Apply when done. Keep these tools off treatment results in before-and-after photos, since an edited result is the first thing people call out.

## Quick fixes

Select a photo and the Quick fixes buttons sit at the top of Properties. Click one and it runs. Click it again to take it off. They stack, so Slim face and Slim body together do both.

- **Glow up:** Enhance faces, Smooth skin, Bright eyes and Whiten teeth at gentle amounts, plus softer highlights, lifted shadows, richer colour and a little warmth. A sunset stays a sunset.
- **Smooth skin:** evens out skin and fine lines on the face. Pores and texture stay.
- **Slim face:** pulls the jawline and cheeks in a little toward the middle of the face.
- **Slim body:** narrows the waist, hips and legs a little and leaves the background straight. Works on one person standing.
- **Enhance faces:** sharpens and cleans up blurry or low-quality faces with the RestoreFormer++ face model. The first use downloads it once (148 MB).
- **Bright eyes:** lifts and sharpens the eyes only.
- **Whiten teeth:** takes the yellow out of the teeth only.

The same buttons are under Image > Quick fixes. A gold button means that fix is on. While one runs, the button shimmers and the rest wait.

Fine tune opens a slider for each fix, 0 to 100, for when the one-click amount is too much or too little. Take all off puts the photo back to how it came in. Nothing is baked in: the fixes stay editable after you save and reopen the design.

Faces are found automatically, every face in the photo. Fixes that need a face skip photos without one and the message says so. Times on a laptop without a graphics card: Smooth skin, Slim face, Bright eyes and Whiten teeth take 5 to 15 seconds, Slim body and Enhance faces up to a minute. A graphics card cuts that down a lot.

Keep these off the treatment result in clinic before-and-after photos. Light, crop and lining up the faces are fine. Slimming or smoothing the after photo changes the result patients are shown. To show what a program can achieve, use Touch up, which marks the touched-up photo as a simulation.

## Upscale

Upscale 2× and Upscale 4× under Retouch, or in the Image menu, make a small or old photo sharp enough for a bigger post or for print. The photo stays the same size on the page with more pixels in it. The result can be up to 8192 pixels wide. It takes a few seconds with a graphics card and up to a minute without one.

## Selections

The selection tools (M, L and W) select part of the page, the way Photoshop does. While one is on, Properties shows what you can do with the selection.

1. Pick the layer to work on in Layers, or All layers in Properties.
2. Pick a tool and drag on the page. Hold Shift to add to the selection and Alt to subtract, or pick New, Add, Subtract or Intersect in the options bar.

- **Polygon lasso:** click each corner, then click the first point, double-click or press Enter to close it.
- **Magic wand:** Tolerance sets how far the colour can drift. Untick Connected only to take that colour everywhere. The last box picks this layer or all layers.
- **Feather:** in the options bar, softens the edge of the next selection.
- **Select subject:** finds the person or product with the background model. It is in the options bar and in the Select menu.
- **Colour range (Select menu):** selects by colour across the page. Click the preview to pick a colour and set Fuzziness, or pick Highlights, Midtones, Shadows or Skin. White in the preview gets selected and grey gets selected partly.
- **From layer:** selects the shape of a layer. Ctrl+click a layer's icon in Layers does the same.
- **Invert (Ctrl+Shift+I), Expand, Contract and Feather:** change the selection. Edge by sets the pixels.

The selection stays when you pick another layer, so the same area works on any layer.

### Using a selection

- **Copy to new layer (Ctrl+J):** puts the selected part on a layer of its own. With All layers picked it copies everything you see.
- **Cut to new layer (Ctrl+Shift+J):** the same, and hides that area on the original.
- **Hide area (Delete):** hides the selected area of the layer with a mask.
- **Keep only area:** hides everything else.
- **Show area again:** brings a hidden area back.
- **Fill as new layer (Alt+Backspace):** fills the selection with the foreground colour.
- **Save selection:** keeps it with the page. Load it from Properties or Select > Load selection. It is saved in the design file.

Press Esc or Ctrl+D to deselect. Ctrl+Z undoes selection changes while the last thing you did was a selection.

## Layers

The Layers panel lists everything on the page with the front at the top. Drag a row to reorder it, double-click to rename it, and use the lock and eye buttons to lock or hide it. An fx tag on a row means the layer has a style, so click it to see the style in Properties.

- **Blend mode and opacity:** above the list, for the chosen layer. Multiply, Screen, Overlay, Soft light and the rest work the way they do in Photoshop.
- **Duplicate:** copies the layer (Ctrl+J).
- **Clip:** shows the layer only inside the layer below it, such as a photo inside big text (Alt+Ctrl+G).
- **Add mask:** keeps the selected area and hides the rest when you have a selection, or adds an empty mask to paint on.
- **Merge down:** flattens the layer into the one below. With several layers selected it says Merge and flattens them all.
- **Group:** with several layers selected (Ctrl+G).
- **Delete:** removes the layer.

Layer > Convert to photo layer turns text or a shape into pixels so photo adjustments and filters work on it.

### Painting a mask

Click a layer and look under Layer in Properties, or use Layer > Layer mask.

- **Paint mask:** a soft brush. Hide (X) paints parts away and Show (X) brings them back. Size and Softness are in the bar at the top of the page.
- **Fade out:** drag across the layer from where it should stay to where it should disappear. A photo fading into the background is the usual use.
- **Radial:** drag out from the middle of what should stay. The inside stays and the outside fades.

Press Done or Enter to keep it, or Cancel or Esc to throw it away. Invert mask, Select shape and Delete mask are under Layer too.

## Layer styles

Under Layer style in Properties, or Layer > Layer style. Tick a style to turn it on and its settings open under it.

- **Drop shadow:** colour, opacity, blur and offset.
- **Stroke:** a line around the shape of the layer, which suits cut-outs and text.
- **Outer glow:** a soft colour around the layer.
- **Inner shadow and inner glow:** shade or light inside the edge.
- **Bevel:** a raised edge lit from the angle you set, which suits gold and metal text.
- **Colour overlay and gradient overlay:** paint the layer one colour or a gradient while keeping its shape.

Layer > Layer style > Copy layer style and Paste layer style put the same look on other layers. Clear layer style takes it all off.

Under Warp in Properties, pick Arc, Arch, Bulge, Flag, Wave or Rise and move Bend both ways. Warp bends text, photos and shapes.

### Distort, perspective and skew

Select a layer and pick Edit > Transform, or the Distort, Perspective and Skew buttons under Position in Properties. Drag the four corner squares.

- **Distort:** each corner goes anywhere, such as fitting a poster onto a wall in a photo.
- **Perspective:** dragging a corner moves the opposite corner on that side the other way, so the layer leans back.
- **Skew:** dragging a corner slides its whole side.

Press Done or Enter to keep it, or Cancel or Esc. Straighten corners puts it back. Free transform (Ctrl+T) goes back to the Move tool with the layer selected.

### Text behind the subject

1. Click a photo of a person or product.
2. Press Text behind subject under Background.
3. The app copies the subject to a layer in front, then puts your text between the photo and that copy. With no text above the photo it adds a big heading.
4. Type over the heading and drag it into place.

## Shapes, icons and QR codes

The Shapes panel and the Shape tool (U) have rectangle, rounded rectangle, circle, triangle, line, star, polygon, badge, arrow, heart, speech bubble and plus. A star, badge or polygon has Points and Depth in Properties, an arrow has Shaft and Head, and a plus has Thickness.

- **Pattern fill:** under Fill, pick Pattern, then dots, stripes, diagonal, checks, grid, waves, zigzag or a photo of your own. Set its colours and size.
- **Combine shapes (Layer menu):** select two or more shapes. Unite joins them, Subtract front cuts the front shapes out of the back one, Intersect keeps the overlap and Exclude overlap keeps everything but the overlap. The result keeps the back shape's colour.
- **Repeat (Edit menu):** copies the selected layer in a grid or around a circle and groups the copies. Ungroup them (Shift+Ctrl+G) to move one on its own.
- **QR code:** type a link. Change the link, the colours and the error correction in Properties. Dark squares on a light background scan best, so test it with your phone before printing.
- **Icons:** 2118 line icons and 30 social and payment logos such as Instagram, Facebook, Messenger, WhatsApp, TikTok, Viber, Shopee, Grab, foodpanda, Visa and PayPal. Search by name, such as phone, clock, gift or map. Change the colour and line width in Properties.

## Drawing

Press B for the Brush. Pick Pen, Marker, Highlighter or Spray, the size and the opacity in the options bar. It draws in the foreground colour. Each stroke is its own layer you can move or delete. Press Esc to go back to the Move tool.

## Brand kits and the eyedropper

The Brand panel keeps colours, a heading font, a body font and logos for each brand, such as Cygnus Aesthetics and Sognare.

- **Colours:** click + to add one. Click the pipette to pick a colour from the page. Right-click a colour to remove it.
- **Fonts:** new text uses the kit's heading and body fonts.
- **Logos:** click one to add it to the page.

Every colour setting in Properties has a pipette too. Click it, then click anywhere on the page to use that colour. Esc cancels.

## Templates and before-and-after

- **Before and after from two photos (File menu):** pick the before photo and the after photo, a layout (Side by side, Stacked, Square or Wide), the labels and how to line them up, then Create. Photos and labels stay separate layers, so you can move or retype them after.
- **Opening two pictures:** pick two pictures in File > Open, or drag two pictures from a folder onto the page, and they open side by side in your saved Before and after layout, lined up.
- **How lining up works:** Line up has four choices.
  - **Auto** (the default) uses the face when it fills a good part of the photo and the body otherwise.
  - **Faces** lines up by the eyes: same size, same tilt, same place.
  - **Bodies** lines up by the shoulders, elbows, hips and knees, for breast, abdomen and full-length photos with or without the head. The before stays framed as you shot it, and the after is moved, scaled and turned to match it.
  - **Off** centres each photo as shot.

  It can't fix a different camera angle, such as the body turned more in one photo or shot from higher up, so take both from the same spot, height and pose. The message after says what it lined up by, or that it found nothing to match in both and centred them.
- **Touch up:** for right after a session, when the result can't be seen yet. Select a photo and press Touch up at the top of Properties (it's also in the Image menu, and with nothing selected it's under the page settings). Pick the touch ups (Slim face, Slim body, Smooth skin, Glow up) and the Amount, then Apply. The photo gets a Simulated goal tag in its top corner.
  - With two or more photos on the page, pick which one under Photo. Only that one changes.
  - With one photo, tick Keep the original beside it to get the untouched photo next to the touched-up copy as a new design, with Today and Goal labels. Face touch ups zoom in on the face and body ones show the whole photo.
  - With nothing open, it asks for a picture.
  - Amount starts at 40, and even 100 stays within what a program can reach, so the patient still looks like themselves. Select the photo afterwards and Fine tune under Quick fixes adjusts each fix on its own.
- **Labels and the tag:** each is a layer you can drag anywhere, so move it off anything you want the patient to see. Select one to change its words, box colour and word colour in Properties, or press Delete to remove it. Label opacity sets how strong Before/After or Today/Goal show, from 0 (hidden) to 100, and starts at 0. Label size and Tag size shrink them when the photo is zoomed in and they'd cover something worth showing. After the design is made, select any label and use All labels opacity and All labels size to change them all together, or select the tag for its own Size. With nothing selected, the label sliders are under Labels in Properties. Untick Show labels to leave them out altogether. The Simulated goal tag has its own Opacity in Properties. It's what keeps a touched-up picture honest when it gets forwarded, so move or recolour it rather than deleting it.
- **Save as default:** the Touch up and Before and after windows, the labels and tag in Properties, and Fine tune under Quick fixes each have a Save as default button. It keeps what you set (touch ups, amount, layout, labels, colours, opacity, sizes, and the amount each Quick fixes button applies), so every new file and every batch Claude runs starts from there.
- **Before and after templates:** Side by side, Top and bottom, and Split. Each has two frames of the same size with BEFORE and AFTER labels. It fills an empty page, or goes on a new page after the current one. Drop a photo on each frame.
- **Save page as template (File menu):** keeps the current page. Click a template to add it as a new page.

## Rulers, guides and the safe zone

- **Rulers (Ctrl+R):** along the top and left of the page, in page pixels.
- **Guides:** drag from a ruler onto the page. Drag the small marker on the ruler to move a guide, or drag it back onto the ruler to remove it. Objects snap to guides. View > Clear guides removes them all.
- **Story safe zone (View menu):** shades the top and bottom of the page where Instagram covers a story with its own buttons. Keep text inside the dashed box.
- **Spacing:** while you drag a layer, orange numbers show the gap to the nearest layer or the page edge on each side. They turn pink when the gaps on both sides match.

A panorama carousel shows where each slide starts, and objects snap to the slide edges.

## Pages and other sizes

A design can hold several pages, such as the slides of a normal carousel. Each page exports as its own file. PageUp and PageDown move between pages.

File > Make other sizes copies the whole design to any of the other sizes, with the text, logos and photos moved to fit. Each size is saved as its own design file in a folder you pick. Open each one and adjust it before exporting.

To control where a layer lands in the other sizes, set In other sizes, stick to under Arrange in Properties, or use Layer > When resizing the design. A logo set to stick to the bottom right stays in that corner on a story and on a square post. Stretch makes a bar or background stretch to the new width or height. Nearest side is the default.

Image > Resize design changes the size of this design and scales the content to fit.

## Exporting

Click Export at the top right (Ctrl+E).

- **Format:** PNG, JPG, WebP or PDF.
- **Size:** 1× or 2×.
- **Quality:** for JPG and WebP.
- **Keep each file under:** for JPG and WebP. The quality steps down until the file fits, which helps for WhatsApp and websites.
- **Transparent background:** for PNG and WebP.
- **Split into slides:** for a panorama carousel. The slides save as numbered files in order.
- **Watermark:** a logo from your brand kits and a line of text, such as your Instagram handle, in the corner you pick. The settings are remembered.
- **PDF:** RGB, or CMYK for print with the paper profile the print shop uses. Preview print colours shows the page as it will print and can mark colours ink cannot reach.

The preview on the right shows the page with the watermark, and the line under it gives the file size and pixel size at the settings you picked. A box lists anything worth fixing first, such as a blurry photo or text off the page.

With several pages or slides, pick a folder and the files save as the design name with -01, -02 and so on.

### Check design

File > Check design lists what to fix before a post goes out, with a Show button for each:

- photos shown bigger than their own pixels, or printing under 150 ppi on a print design
- empty frames
- text running past the edge of the page
- text under Instagram's buttons on a story
- fonts that are not on this computer

### Batch export and spreadsheet posts

File > Batch export and spreadsheet posts makes one picture per row, such as the same post with different products, prices or photos.

1. Tick the texts and photos that change.
2. Fill one row per version, press Paste rows and paste from Excel, or press Load spreadsheet (CSV).
3. Fill the photo column from a set of files if the photos change.
4. Press Export all to save the pictures, or Add as pages to put each row on its own page of this design.

A spreadsheet needs column names in its first row. Save it from Excel or Google Sheets as CSV.

- A column named like a layer fills that layer. Name the price text layer Price in Layers and a Price column fills it.
- Text can hold placeholders in double curly brackets. "Only {{Price}}" becomes "Only ₱250" for a row with ₱250 in its Price column.
- A photo column holds file names, such as dark.jpg. The app asks you to pick those photos and matches them by name.
- A column called File name names each picture.

Tick Watermark to use the watermark set in Export.

## Saving

Save and Save as write a design file (.zip) with the photos, masks, colour lookups, saved selections, guides and added fonts inside it. Everything stays editable when you open it again, adjustment layers and layer styles included. The app also saves a copy every few seconds, and after a crash it offers to restore the design you were working on.

The History panel lists every step on the current page. Click a step to go back to it.

## Letting Claude edit for you

Claude can work Photo Editor on your computer while you describe what you want in a Claude chat, such as "open the Sognare bar photo, remove the background, put it on navy and add the price in gold". It uses the same tools you do: layers, adjustments, Quick fixes, Remove background, Text behind subject, Upscale, Before and after, the menu commands, Save and Export. It looks at a preview after each change, and you can watch the edit happen and take over at any time.

It also works through whole folders. Things you can ask:

- "Glow up every photo in Desktop\Shoot 12 and save them in a new folder."
- "In Clients\Botox October, pair each before with its after and make side by side before and afters, labelled Before and 2 weeks. Name each file after the client."
- "Slim face and smooth skin on the selected photo, then export it as a JPG next to the original."
- "Touch up everyone in Consults\Week 1 with slim body, original beside each, and save them in a Touch ups folder."

For groups it lists the folder, works out the pairs from the file names, runs them in one go and saves a picture plus an editable .zip for each. It tells you which pairs had no face to line up and which files it skipped. Any Claude app with the connector below added can do this.

### Switching it on

1. Open Photo Editor.
2. Tick Help > Let Claude control this app. A gold "Claude control on" chip shows in the status bar.
3. Click the chip, or untick the menu item, to switch it off. The setting is remembered for the next start.

Claude can only reach Photo Editor while this is ticked, and only from your own computer.

### Connecting it to the Claude app (once)

The connector is `mcp\photo-editor-mcp.mjs` in the Photo Editing folder. It needs Node.js, which the editor already uses.

1. Open the Claude desktop app and go to Settings > Developer > Edit Config. This opens the folder with `claude_desktop_config.json`.
2. Copy `claude_desktop_config.json` to your desktop as a backup before changing it, since a typo in it stops every connector from loading (Blender, Godot and Playwright included).
3. Open it in Notepad. Inside `"mcpServers": {`, add this entry after the last one, with a comma after the entry before it:

   ```json
   "photo-editor": {
     "command": "node",
     "args": ["C:\\Users\\User\\Documents\\Coding Projects\\Photo Editing\\mcp\\photo-editor-mcp.mjs"]
   }
   ```

4. Save, then quit the Claude app completely (right-click its icon by the clock > Quit) and open it again.
5. In a chat, ask Claude what Photo Editor has open. It answers with the design's name and size.

On a Mac the path is the folder where you keep Photo Editing, such as `/Users/you/Documents/Photo Editing/mcp/photo-editor-mcp.mjs`, and the config is under Claude > Settings > Developer as well.

### What Claude will and will not do

- It opens files, saves designs and exports pictures only at the paths it names in the chat.
- It will not replace a file that already exists or close a design with unsaved changes unless you tell it to.
- It saves batch results as new files and never changes the originals.
- It won't slim, smooth or reshape the after photo of a treatment to make the result look bigger, and won't make a before photo look worse. For a simulated goal it uses Touch up, which keeps the Simulated goal tag on.
- File pickers, batch export, Make other sizes, adding fonts, retouch painting and the cut-out editor stay with you. Claude asks you to do those.
- When Photo Editor is closed or the switch is off, Claude says so and stops.

## Shortcuts

Help > Keyboard shortcuts (?) lists every shortcut from the menus. The main ones:

| Keys | Action |
| --- | --- |
| Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S | New, open, save, save as |
| Ctrl+E | Export |
| Ctrl+F | Search commands |
| Ctrl+Z, Ctrl+Y | Undo, redo |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste |
| Ctrl+J or Ctrl+D | Duplicate. With a selection, Ctrl+D deselects and Ctrl+J copies the selected part |
| Ctrl+T | Free transform |
| Ctrl+L, Ctrl+M, Ctrl+U, Ctrl+B | Levels, Curves, Colour mixer, Colour grading |
| Shift+Ctrl+L, Shift+Ctrl+B | Auto tone, auto colour |
| Shift+Ctrl+C, Shift+Ctrl+V | Copy and paste adjustments |
| Alt+Backspace, Ctrl+Backspace | Fill with the foreground or background colour |
| Ctrl+G, Ctrl+Shift+G | Group, ungroup |
| Alt+Ctrl+G | Clip to the layer below |
| Ctrl+/ | Lock or unlock |
| Ctrl+] and Ctrl+[ | Forward, backward. Add Shift for front and back |
| Ctrl+A | Select all layers. With a selection tool on it selects the whole page |
| Ctrl+Shift+I | Invert the selection |
| Ctrl+R | Rulers |
| Ctrl+0, Ctrl+1 | Fit on screen, 100% |
| V, M, L, W, C, I, J, B, T, U, K, H, Z | Tools |
| X, D | Swap colours, black and white |
| Arrow keys | Nudge 1 px, or 10 px with Shift |
| Delete | Delete. With a selection it hides that area |
| Enter | Edit the selected text, or crop the selected photo |
| Esc | Back to the Move tool, then deselect |
| Space + drag | Pan |
| Ctrl + mouse wheel | Zoom |
| Alt while dragging | Move without snapping |

## Where things are kept

| What | Windows | Mac |
| --- | --- | --- |
| Brand kits, fonts, templates, text styles, recent designs, autosave and settings | `%APPDATA%\com.cygnussolutions.photoeditor` | `~/Library/Application Support/com.cygnussolutions.photoeditor` |
| Background model (179 MB) | `models` inside the same folder | `models` inside the same folder |
| Face model for Enhance faces and Glow up (148 MB) | `models` inside the same folder | `models` inside the same folder |
| Claude connection (port and token, while switched on) | `mcp.json` inside the same folder | `mcp.json` inside the same folder |
| Designs | wherever you save them, as .zip files | wherever you save them, as .zip files |

Send Claude a screenshot if anything in this guide does not match what you see.
