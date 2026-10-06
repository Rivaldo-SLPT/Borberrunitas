"""
Sintetiza los efectos de sonido y jingles del juego en estilo chiptune
retro (ondas simples + ruido, sin samples externos) y los guarda directo
en public/assets/audio/.

Uso:
    python tools/generate_sfx.py
"""
import math
import numpy as np
import wave
import os

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'audio')


# ---------------------------------------------------------------------------
# Osciladores
# ---------------------------------------------------------------------------
def t_axis(duration):
    return np.linspace(0, duration, int(SR * duration), endpoint=False)


def sine(freq, duration, phase=0.0):
    return np.sin(2 * np.pi * freq * t_axis(duration) + phase)


def square(freq, duration, duty=0.5):
    ph = (freq * t_axis(duration)) % 1.0
    return np.where(ph < duty, 1.0, -1.0)


def triangle(freq, duration):
    ph = (freq * t_axis(duration)) % 1.0
    return 2 * np.abs(2 * (ph - np.floor(ph + 0.5))) - 1


def noise(duration, seed=0):
    rng = np.random.default_rng(seed)
    return rng.uniform(-1, 1, int(SR * duration))


def sine_sweep(freq_start, freq_end, duration):
    tt = t_axis(duration)
    k = (freq_end - freq_start) / max(duration, 1e-9)
    phase = 2 * np.pi * (freq_start * tt + 0.5 * k * tt ** 2)
    return np.sin(phase)


# ---------------------------------------------------------------------------
# Envolventes / utilidades
# ---------------------------------------------------------------------------
def adsr(signal, attack=0.01, decay=0.05, sustain=0.7, release=0.1):
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


def lowpass(signal, window):
    if window <= 1:
        return signal
    kernel = np.ones(window) / window
    return np.convolve(signal, kernel, mode='same')


def mix(*signals):
    n = max(len(s) for s in signals)
    out = np.zeros(n)
    for s in signals:
        out[:len(s)] += s
    return out


def normalize(signal, peak=0.9):
    m = np.max(np.abs(signal)) or 1.0
    return signal / m * peak


def save_wav(signal, name):
    signal = normalize(signal)
    pcm = (signal * 32767).astype(np.int16)
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    print(f'  {name} ({len(signal) / SR * 1000:.0f}ms)')


def note(freq, duration, wave_fn=square, **adsr_kwargs):
    return adsr(wave_fn(freq, duration), **adsr_kwargs)


def sequence(*parts, gap=0.0):
    """Concatena (signal, ...) con silencio `gap` entre cada uno."""
    silence = np.zeros(int(SR * gap))
    out = []
    for i, p in enumerate(parts):
        out.append(p)
        if i < len(parts) - 1:
            out.append(silence)
    return np.concatenate(out)


NOTE = {  # frecuencias (Hz), notacion cientifica
    'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23, 'G4': 392.00,
    'A4': 440.00, 'B4': 493.88, 'C5': 523.25, 'E5': 659.25, 'G5': 783.99,
    'C3': 130.81, 'A3': 220.00, 'F3': 174.61, 'D3': 146.83,
}


# ---------------------------------------------------------------------------
# SFX
# ---------------------------------------------------------------------------
def make_ui_click():
    s = note(1400, 0.05, wave_fn=square, attack=0.001, decay=0.02, sustain=0.2, release=0.02)
    return s


def make_bomb_plant():
    thud = note(160, 0.12, wave_fn=triangle, attack=0.001, decay=0.05, sustain=0.3, release=0.06)
    click = note(700, 0.02, wave_fn=square, attack=0.001, decay=0.01, sustain=0.1, release=0.01)
    return mix(thud, click)


def make_block_destroy():
    n = lowpass(noise(0.18, seed=3), 4)
    return adsr(n, attack=0.001, decay=0.06, sustain=0.15, release=0.08)


def make_explosion():
    rumble = adsr(sine_sweep(180, 45, 0.55), attack=0.005, decay=0.15, sustain=0.4, release=0.35)
    blast = adsr(lowpass(noise(0.4, seed=7), 3), attack=0.001, decay=0.12, sustain=0.25, release=0.28)
    crack = adsr(noise(0.06, seed=11), attack=0.001, decay=0.02, sustain=0.1, release=0.02)
    return mix(rumble * 0.8, blast * 0.9, crack * 0.6)


def make_powerup():
    notes = ['C5', 'E5', 'G5', 'C5']
    parts = [note(NOTE[n], 0.09, wave_fn=square, attack=0.002, decay=0.02, sustain=0.6, release=0.04) for n in notes]
    return sequence(*parts, gap=0.005)


def make_player_die():
    notes = ['A4', 'F4', 'D4', 'C3']
    durs = [0.12, 0.12, 0.14, 0.28]
    parts = [note(NOTE[n], d, wave_fn=triangle, attack=0.002, decay=0.05, sustain=0.5, release=0.08)
             for n, d in zip(notes, durs)]
    return sequence(*parts, gap=0.01)


def make_step():
    tap1 = adsr(lowpass(noise(0.05, seed=21), 3), attack=0.001, decay=0.015, sustain=0.1, release=0.02)
    tap2 = adsr(lowpass(noise(0.05, seed=22), 3), attack=0.001, decay=0.015, sustain=0.1, release=0.02)
    gap = np.zeros(int(SR * 0.22))
    return np.concatenate([tap1, gap, tap2, gap])


# ---------------------------------------------------------------------------
# Jingles (victory / gameover) - reemplazan a los .mp3 de BGM (ver config.js)
# ---------------------------------------------------------------------------
def make_victory():
    notes = ['C4', 'E4', 'G4', 'C5', 'G4', 'C5']
    durs = [0.14, 0.14, 0.14, 0.28, 0.14, 0.4]
    parts = [note(NOTE.get(n, 523.25), d, wave_fn=square, attack=0.003, decay=0.03, sustain=0.65, release=0.08)
             for n, d in zip(notes, durs)]
    melody = sequence(*parts, gap=0.01)
    harmony = adsr(triangle(130.81, len(melody) / SR), attack=0.02, decay=0.3, sustain=0.4, release=0.3) * 0.3
    return mix(melody, harmony)


def make_gameover():
    notes = ['A4', 'G4', 'F4', 'D4']
    durs = [0.22, 0.22, 0.22, 0.5]
    parts = [note(NOTE[n], d, wave_fn=triangle, attack=0.01, decay=0.08, sustain=0.4, release=0.15)
             for n, d in zip(notes, durs)]
    return sequence(*parts, gap=0.02)


if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    print('SFX:')
    save_wav(make_ui_click(), 'ui_click.wav')
    save_wav(make_bomb_plant(), 'bomb_plant.wav')
    save_wav(make_block_destroy(), 'block_destroy.wav')
    save_wav(make_explosion(), 'explosion.wav')
    save_wav(make_powerup(), 'powerup.wav')
    save_wav(make_player_die(), 'player_die.wav')
    save_wav(make_step(), 'step.wav')
    print('Jingles:')
    save_wav(make_victory(), 'victory.wav')
    save_wav(make_gameover(), 'gameover.wav')
