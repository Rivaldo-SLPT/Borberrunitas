"""
Genera menu_theme.mp3 (en realidad .wav, ver nota en config.js) como un
loop ambiental sintetizado: pad sostenido + melodia pentatonica suelta +
tambor grave ocasional. Pensado para sonar en bucle sin corte abrupto.

Esto es lo mas dificil de sintetizar bien de todo el set de audio - es un
intento razonable, no un reemplazo de una pista compuesta/grabada de
verdad. Si mas adelante consiguen una pista real, solo hay que reemplazar
el archivo (mismo nombre, mismo lugar).

Uso:
    python tools/generate_menu_theme.py
"""
import numpy as np
import wave
import os

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'audio')
DURATION = 24.0  # loop total, en segundos


def t_axis(duration, offset=0.0):
    return np.linspace(offset, offset + duration, int(SR * duration), endpoint=False)


def sine(freq, duration, offset=0.0):
    return np.sin(2 * np.pi * freq * t_axis(duration, offset))


def triangle(freq, duration, offset=0.0):
    tt = t_axis(duration, offset)
    ph = (freq * tt) % 1.0
    return 2 * np.abs(2 * (ph - np.floor(ph + 0.5))) - 1


def adsr(signal, attack=0.05, decay=0.15, sustain=0.5, release=0.3):
    n = len(signal)
    a = int(SR * attack)
    d = int(SR * decay)
    r = int(SR * release)
    s = max(n - a - d - r, 0)
    env = np.concatenate([
        np.linspace(0, 1, max(a, 1)),
        np.linspace(1, sustain, max(d, 1)),
        np.full(s, sustain),
        np.linspace(sustain, 0, max(r, 1))
    ])[:n]
    if len(env) < n:
        env = np.pad(env, (0, n - len(env)))
    return signal * env


def place(buffer, signal, start_time):
    start = int(start_time * SR)
    end = min(start + len(signal), len(buffer))
    buffer[start:end] += signal[:end - start]


# escala pentatonica menor "andina" sobre C3 (mistica, calma)
PENT = [130.81, 155.56, 174.61, 196.00, 233.08, 261.63, 311.13, 349.23]


def build():
    n_samples = int(SR * DURATION)
    mix = np.zeros(n_samples)

    # --- pad sostenido (raiz + quinta), con "respiracion" ciclica que
    # completa un numero entero de ciclos en la duracion total -> loop
    # sin salto de amplitud en el punto de union.
    root = sine(65.41, DURATION) * 0.5 + sine(98.00, DURATION) * 0.3
    breath_cycles = 4
    breath = 0.65 + 0.35 * np.sin(2 * np.pi * breath_cycles * np.arange(n_samples) / n_samples)
    pad = root * breath * 0.35
    mix += pad

    # --- tambor grave cada 3s (loopea limpio: DURATION/3 es entero)
    beat_period = 3.0
    for i in range(int(DURATION / beat_period)):
        thump = adsr(sine(60, 0.35, offset=0), attack=0.002, decay=0.12, sustain=0.2, release=0.2) * 0.5
        place(mix, thump, i * beat_period)

    # --- melodia pentatonica suelta, semilla fija para que sea la misma
    # cada vez que se regenere; deja de sonar 2s antes del final para que
    # la cola decaiga a silencio antes del punto de loop.
    rng = np.random.default_rng(42)
    t = 1.0
    melody_end = DURATION - 2.5
    while t < melody_end:
        freq = rng.choice(PENT)
        dur = rng.choice([0.9, 1.2, 1.6])
        vol = rng.uniform(0.12, 0.2)
        note_sig = adsr(triangle(freq, dur), attack=0.03, decay=0.2, sustain=0.4, release=dur * 0.6) * vol
        place(mix, note_sig, t)
        t += rng.choice([1.4, 1.8, 2.2])

    return mix


def save_wav(signal, name):
    peak = np.max(np.abs(signal)) or 1.0
    signal = signal / peak * 0.85
    pcm = (signal * 32767).astype(np.int16)
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(f'{name} ({len(signal) / SR:.1f}s)')


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    save_wav(build(), 'menu_theme.wav')
