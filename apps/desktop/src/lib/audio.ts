import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';

/** A sound bank of audio.rpf. */
export type AudioBank = {
  /** Offset in audio.rpf, hex: the id. */
  id: string;
  name: string | null;
  size: number;
  streams: number;
  seconds: number;
};

/** A stream of a bank. */
export type AudioStream = {
  /** Hash id, 8 hex digits. */
  id: string;
  name: string | null;
  seconds: number;
  channels: number;
  /** `blocks` (Opus), `music` (stems), `pcm16`, `pcmf32`, `xma2`, `other`. */
  layout: string;
  playable: boolean;
};

let banks: Promise<AudioBank[]> | null = null;
let banksRoot = '';

/** Every bank of audio.rpf that holds sound; the first call scans the archive (a few minutes). */
export function audioBanks(root: string): Promise<AudioBank[]> {
  if (!banks || banksRoot !== root) {
    banksRoot = root;
    banks = invoke<AudioBank[]>('audio_bank_list', { root });
    banks.catch(() => {
      banks = null;
    });
  }
  return banks;
}

export function audioStreams(root: string, bank: string): Promise<AudioStream[]> {
  return invoke<AudioStream[]>('audio_stream_list', { root, bank });
}

/** The extension a stream plays and saves as. */
export function audioExtension(stream: AudioStream): 'ogg' | 'wav' {
  return stream.layout.startsWith('pcm') ? 'wav' : 'ogg';
}

/** Stream `stream` of `bank` as an object URL to play; revoke it when done. */
export async function audioUrl(root: string, bank: string, stream: AudioStream): Promise<string> {
  const bytes = await invoke<ArrayBuffer>('audio_stream', { root, bank, stream: stream.id });
  const type = audioExtension(stream) === 'wav' ? 'audio/wav' : 'audio/ogg';
  return URL.createObjectURL(new Blob([bytes], { type }));
}

/** Asks where to save a stream and writes it there (Ogg Opus or WAV, as stored: no re-encoding). */
export async function saveAudio(root: string, bank: string, stream: AudioStream): Promise<string | null> {
  const extension = audioExtension(stream);
  const dest = await save({
    title: 'Save sound',
    defaultPath: `${stream.name ?? `${bank}_${stream.id}`}.${extension}`,
    filters: [{ name: extension === 'wav' ? 'WAV' : 'Ogg Opus', extensions: [extension] }],
  });
  if (!dest) return null;
  await invoke('save_audio', { root, bank, stream: stream.id, dest });
  return dest;
}

/** `1:05`, `0:03`. */
export function formatSeconds(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
