/**
 * Зумер через WebAudio.
 *
 * На платі стоїть п'єзо-випромінювач, який уміє лише вмикати й вимикати одну
 * частоту. Тому тут прямокутна хвиля без огинаючої й без гармонік — синусоїда
 * звучала б м'якше, ніж залізо.
 *
 * Тривалість ноти рахується так само, як у `Buzzer::melodyTask`:
 *   duration = (60000 / tempo) / |size|
 * і додається половина, якщо `size` від'ємний — це нота з крапкою.
 * Частота 0 означає паузу.
 *
 * `playMelody` у прошивці запускає окреме завдання і повертає керування одразу,
 * тож і тут відтворення не блокує нічого.
 */

import type { SoundEvent } from './shared.ts';

const PEAK = 0.12;

export class BuzzerAudio {
    private context: AudioContext | null = null;
    private oscillator: OscillatorNode | null = null;
    private gain: GainNode | null = null;

    /**
     * Контекст створюється при першій події, а не наперед: браузер не дозволяє
     * запускати звук до дії користувача, а «Запустити» — саме така дія.
     */
    private ensure(): { context: AudioContext; oscillator: OscillatorNode; gain: GainNode } | null {
        if (typeof AudioContext === 'undefined') return null;

        if (!this.context) {
            this.context = new AudioContext();
            this.gain = this.context.createGain();
            this.gain.gain.value = 0;
            this.gain.connect(this.context.destination);

            this.oscillator = this.context.createOscillator();
            this.oscillator.type = 'square';
            this.oscillator.frequency.value = 440;
            this.oscillator.connect(this.gain);
            this.oscillator.start();
        }
        if (this.context.state === 'suspended') void this.context.resume();
        return { context: this.context, oscillator: this.oscillator!, gain: this.gain! };
    }

    handle(event: SoundEvent): void {
        const parts = this.ensure();
        if (!parts) return;
        const { context, oscillator, gain } = parts;
        const now = context.currentTime;

        // Скасовуємо все заплановане: нова команда витісняє попередню,
        // як і на залізі, де завдання мелодії одне
        gain.gain.cancelScheduledValues(now);
        oscillator.frequency.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);

        if (event.kind === 'stop') return;

        if (event.kind === 'tone') {
            if (event.frequency <= 0) return;
            oscillator.frequency.setValueAtTime(event.frequency, now);
            gain.gain.setValueAtTime(PEAK, now);
            if (event.durationMs !== null) {
                gain.gain.setValueAtTime(0, now + event.durationMs / 1000);
            }
            return;
        }

        // мелодія: ноти плануються одна за одною наперед
        let at = now;
        const tempo = event.tempo || 120;
        for (const tone of event.tones) {
            if (tone.size === 0) continue;
            let duration = 60000 / tempo / Math.abs(tone.size);
            if (tone.size < 0) duration += duration / 2;
            const seconds = duration / 1000;

            if (tone.frequency > 0) {
                oscillator.frequency.setValueAtTime(tone.frequency, at);
                gain.gain.setValueAtTime(PEAK, at);
                // коротка пауза між нотами, інакше сусідні ноти зливаються
                gain.gain.setValueAtTime(0, at + Math.max(seconds - 0.008, seconds * 0.5));
            }
            at += seconds;
        }
        gain.gain.setValueAtTime(0, at);
    }

    /** Тиша негайно — потрібно при зупинці програми. */
    silence(): void {
        if (!this.context || !this.gain) return;
        const now = this.context.currentTime;
        this.gain.gain.cancelScheduledValues(now);
        this.oscillator?.frequency.cancelScheduledValues(now);
        this.gain.gain.setValueAtTime(0, now);
    }
}
