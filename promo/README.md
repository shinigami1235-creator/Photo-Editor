# Pitch video source

`promo.html` draws the 62-second pitch video on a canvas, timed to the beat of `music.py`, which writes the 128 BPM soundtrack as `music.wav`. The pictures it loads from `assets/` are exports from Photo Editor and the test photos, and the fonts in `fonts/` come from `node_modules/@fontsource`. Neither folder is kept here since they are large.

Each frame is drawn by `window.render(t)` and saved, then ffmpeg joins the frames with the music into `Photo Editor promo.mp4`.
