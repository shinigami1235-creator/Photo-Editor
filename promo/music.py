import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 44100
BPM = 128
BEAT = 60 / BPM
BAR = BEAT * 4
BARS = 32
TAIL = 2.5
N = int((BARS * BAR + TAIL) * SR)
rng = np.random.default_rng(7)

def t_(dur): return np.arange(int(dur * SR)) / SR
def place(buf, sig, at):
    i = int(at * SR); j = min(len(buf), i + len(sig))
    if i < len(buf): buf[i:j] += sig[:j - i]
def lp(x, f, order=2): return sosfilt(butter(order, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'high', fs=SR, output='sos'), x)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x)
def midi(n): return 440 * 2 ** ((n - 69) / 12)
def saw(f, t, phase=0.0): return 2 * ((f * t + phase) % 1) - 1

drums = np.zeros(N); bass = np.zeros(N); chords = np.zeros(N); lead = np.zeros(N); fx = np.zeros(N); send = np.zeros(N)

# ---------- sounds ----------
def kick():
    t = t_(0.45); f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(len(t)), 2000) * np.exp(-t * 300) * 0.25
    return np.tanh((s + click) * 1.6) * 0.95
def clap():
    t = t_(0.35); n = rng.standard_normal(len(t))
    env = np.zeros(len(t))
    for d in (0, 0.009, 0.018): env += np.exp(-np.clip(t - d, 0, None) * 60) * (t >= d)
    env += np.exp(-t * 14) * 0.5
    return bp(n, 900, 5000) * env * 0.5
def hat(open_=False):
    t = t_(0.25 if open_ else 0.06)
    return hp(rng.standard_normal(len(t)), 7000, 4) * np.exp(-t * (14 if open_ else 70)) * 0.22
def crash():
    t = t_(2.6)
    return hp(rng.standard_normal(len(t)), 4000, 2) * np.exp(-t * 1.6) * 0.28
def boom():
    t = t_(1.6); f = 30 + 60 * np.exp(-t * 4)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2) * 0.9
def pluck(note, dur=0.22, bright=1.0):
    t = t_(dur + 0.3); f = midi(note)
    s = (saw(f, t) + saw(f * 1.006, t, 0.3)) * 0.5
    env = np.exp(-t * 9)
    cutoff = np.clip(1200 + 5000 * bright * np.exp(-t * 14), 200, 18000)
    # Two fixed filters mixed by the envelope stand in for a sweeping filter.
    s = lp(s, 6500) * np.exp(-t * 18) + lp(s, 1500) * (1 - np.exp(-t * 18))
    return s * env * 0.32
def supersaw(notes, dur):
    t = t_(dur); s = np.zeros(len(t))
    for n in notes:
        for k, d in enumerate((-0.12, -0.05, 0, 0.05, 0.12)):
            s += saw(midi(n) * 2 ** (d / 12), t, k * 0.21)
    s /= len(notes) * 5
    att = np.clip(t / 0.02, 0, 1); rel = np.clip((dur - t) / 0.08, 0, 1)
    return s * att * rel
def bass_note(note, dur):
    t = t_(dur); f = midi(note)
    s = saw(f, t) * 0.6 + np.sign(np.sin(2 * np.pi * f / 2 * t)) * 0.25 + np.sin(2 * np.pi * f / 2 * t) * 0.6
    s = lp(s, 900)
    env = np.clip(t / 0.005, 0, 1) * np.clip((dur - t) / 0.02, 0, 1)
    return s * env * 0.45

# A minor: Am F C G
PROG = [(57, [57, 60, 64, 69]), (53, [53, 57, 60, 65]), (48, [55, 60, 64, 67]), (55, [55, 59, 62, 67])]
ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 3, 1, 2]
HOOK = [76, None, 74, 72, None, 72, 74, None, 76, None, 79, 76, None, 74, 72, None]

def section(b):
    if b < 2: return 'intro'
    if b < 4: return 'build'
    if b < 16: return 'dropA'
    if b < 18: return 'break'
    if b < 28: return 'dropB'
    return 'outro'

K, C = kick(), clap()
for b in range(BARS):
    s = section(b); t0 = b * BAR
    root, chord = PROG[b % 4]
    # chords on every bar, filtered in the quiet sections
    pad = supersaw([n + 12 for n in chord], BAR)
    if s == 'intro': pad = lp(pad, 900) * 0.8
    elif s == 'build': pad = lp(pad, 900 + 3500 * ((b - 2) / 2)) * 0.9
    elif s in ('break',): pad = lp(pad, 2500)
    elif s == 'outro': pad = lp(pad, 5000) if b < 31 else lp(supersaw([n + 12 for n in PROG[0][1]], BAR + TAIL), 3000)
    else: pad = lp(pad, 7000)
    place(chords, pad, t0)
    for i in range(4):
        tb = t0 + i * BEAT
        four = s in ('dropA', 'dropB') or (s == 'outro' and b < 30)
        if four or (s == 'intro' and i in (0,)) :
            place(drums, K * (1 if four else 0.6), tb)
        if s in ('dropA', 'dropB') or (s == 'outro' and b < 30):
            if i in (1, 3): place(drums, C, tb); place(send, C * 0.5, tb)
            place(drums, hat(True) * 0.6, tb + BEAT / 2)
            if s == 'dropB':
                for q in (0.25, 0.75): place(drums, hat() * 0.7, tb + BEAT * q)
            else:
                place(drums, hat() * 0.6, tb)
        if s == 'break': place(drums, hat() * 0.5, tb + BEAT / 2)
        # bass: offbeat 8ths in the drops
        if s in ('dropA', 'dropB') or (s == 'outro' and b < 30):
            place(bass, bass_note(root - 12, BEAT / 2 * 0.9), tb + BEAT / 2)
            if i == 3 and b % 2: place(bass, bass_note(root, BEAT / 4 * 0.9), tb + BEAT * 0.75)
    # plucked arpeggio
    if s in ('dropA', 'dropB', 'break', 'build'):
        for k in range(16):
            n = chord[ARP[k]] + (24 if s == 'dropB' else 12)
            p_ = pluck(n, bright=0.6 if s == 'build' else 1.0) * (0.55 if s == 'build' else 0.8)
            place(lead, p_, t0 + k * BEAT / 4); place(send, p_ * 0.35, t0 + k * BEAT / 4)
    # hook melody in drop B
    if s == 'dropB':
        for k, n in enumerate(HOOK):
            if n is None: continue
            p_ = pluck(n + 12 * 0, dur=0.32, bright=1.0) * 1.1
            place(lead, p_, t0 + k * BEAT / 2 * 0.5 * 2 if False else t0 + k * BEAT / 4 * 1); place(send, p_ * 0.5, t0 + k * BEAT / 4)

# snare roll and riser into each drop
def build_fx(start_bar, bars):
    t0 = start_bar * BAR; dur = bars * BAR
    steps = [(BEAT, 0, 0.5), (BEAT / 2, 0.5, 0.75), (BEAT / 4, 0.75, 0.9), (BEAT / 8, 0.9, 1.0)]
    for step, a, z in steps:
        tt = t0 + a * dur
        while tt < t0 + z * dur - 1e-6:
            g = 0.25 + 0.75 * ((tt - t0) / dur)
            place(drums, C * 0.55 * g, tt); tt += step
    t = t_(dur); n = rng.standard_normal(len(t))
    lo = hp(n, 600) * 0.5 + hp(n, 3000) * 0.5 * (t / dur)
    place(fx, lo * (t / dur) ** 2 * 0.35, t0)
    f = 200 * 2 ** (3 * t / dur)
    place(fx, lp(saw(1, np.cumsum(f) / SR), 4000) * (t / dur) ** 2 * 0.12, t0)
build_fx(2, 2)
build_fx(17, 1)

for b in (4, 18, 28):
    place(fx, crash(), b * BAR); place(drums, boom() * 0.8, b * BAR); place(send, crash() * 0.4, b * BAR)
# final hit
place(fx, crash() * 1.2, 31 * BAR + 2 * BEAT); place(drums, boom(), 31 * BAR + 2 * BEAT); place(drums, K, 31 * BAR + 2 * BEAT)

# sidechain pump on bass, chords and lead, keyed to the kick grid in the drops
pump = np.ones(N)
tt = np.arange(N) / SR
for b in range(BARS):
    if section(b) in ('dropA', 'dropB') or (section(b) == 'outro' and b < 30):
        for i in range(4):
            a = int((b * BAR + i * BEAT) * SR); z = min(N, a + int(BEAT * SR))
            x = (np.arange(z - a) / SR) / (BEAT * 0.55)
            pump[a:z] = np.minimum(pump[a:z], 0.25 + 0.75 * np.clip(x, 0, 1) ** 1.5)

# reverb send
ir_t = t_(2.2); ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 3.2); ir = lp(ir, 6000); ir /= np.sqrt(np.sum(ir ** 2))
rev = fftconvolve(send, ir)[:N] * 0.35

L = drums * 0.9 + bass * pump * 0.9 + chords * pump * 0.55 + lead * pump * 0.55 + fx + rev
R = L.copy()
# a little width: delay chords and lead slightly on one side
d = int(0.012 * SR)
wide = (chords * pump * 0.55 + lead * pump * 0.55)
R = R - wide + np.concatenate([np.zeros(d), wide[:-d]])
mix = np.stack([L, R], 1)
mix = hp(mix.T, 25).T
peak = np.max(np.abs(mix)); mix = mix / peak * 1.6
mix = np.tanh(mix) / np.tanh(1.6) * 0.92
fade = np.ones(N); fl = int(1.5 * SR); fade[-fl:] = np.linspace(1, 0, fl)
mix *= fade[:, None]
wavfile.write('/tmp/promo/music.wav', SR, (mix * 32767).astype(np.int16))
print('seconds', N / SR, 'rms', np.sqrt(np.mean(mix ** 2)))
