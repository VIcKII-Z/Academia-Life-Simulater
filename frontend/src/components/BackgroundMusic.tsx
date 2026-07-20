import { useEffect, useRef } from "react";

const TRACKS = [
  new URL("../../../resource/Journals_of_Somewhere_Else_2026-07-20T083406.mp3", import.meta.url).href,
  new URL("../../../resource/Journal_of_Possible_Futures_2026-07-20T083406.mp3", import.meta.url).href,
];

const TARGET_VOLUME = 0.32;
const FADE_SECONDS = 3;
const CHECK_INTERVAL_MS = 350;

export default function BackgroundMusic({ playing }: { playing: boolean }) {
  const audiosRef = useRef<HTMLAudioElement[]>([]);
  const currentIndexRef = useRef(0);
  const startedRef = useRef(false);
  const transitioningRef = useRef(false);
  const fadeFramesRef = useRef<number[]>([]);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    const audios = TRACKS.map((src) => {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.volume = 0;
      return audio;
    });

    audiosRef.current = audios;

    return () => {
      stopPlayback();
      audiosRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (playing) {
      void startPlayback();
      window.addEventListener("pointerdown", retryPlayback);
      window.addEventListener("keydown", retryPlayback);
    } else {
      fadeOutAndPause();
    }

    return () => {
      window.removeEventListener("pointerdown", retryPlayback);
      window.removeEventListener("keydown", retryPlayback);
    };
  }, [playing]);

  function retryPlayback() {
    if (!playing || startedRef.current) return;
    void startPlayback();
  }

  async function startPlayback() {
    const audio = audiosRef.current[currentIndexRef.current];
    if (!audio || startedRef.current) return;

    try {
      audio.currentTime = 0;
      audio.volume = 0;
      await audio.play();
      startedRef.current = true;
      fade(audio, 0, TARGET_VOLUME, FADE_SECONDS);
      startTransitionWatcher();
    } catch {
      // Browsers may block autoplay after async loading; the next click/key
      // in the game retries playback through the listeners above.
    }
  }

  function startTransitionWatcher() {
    if (intervalRef.current !== null) return;

    intervalRef.current = window.setInterval(() => {
      const audio = audiosRef.current[currentIndexRef.current];
      if (!audio || transitioningRef.current || !startedRef.current) return;

      const remaining = audio.duration - audio.currentTime;
      if (!Number.isFinite(remaining)) return;

      if (remaining <= FADE_SECONDS) {
        void crossFadeToNextTrack();
      }
    }, CHECK_INTERVAL_MS);
  }

  async function crossFadeToNextTrack() {
    const audios = audiosRef.current;
    const currentAudio = audios[currentIndexRef.current];
    const nextIndex = (currentIndexRef.current + 1) % audios.length;
    const nextAudio = audios[nextIndex];
    if (!currentAudio || !nextAudio || transitioningRef.current) return;

    transitioningRef.current = true;
    nextAudio.currentTime = 0;
    nextAudio.volume = 0;

    try {
      await nextAudio.play();
      fade(currentAudio, currentAudio.volume, 0, FADE_SECONDS, () => {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      });
      fade(nextAudio, 0, TARGET_VOLUME, FADE_SECONDS, () => {
        currentIndexRef.current = nextIndex;
        transitioningRef.current = false;
      });
    } catch {
      transitioningRef.current = false;
    }
  }

  function fadeOutAndPause() {
    const currentAudio = audiosRef.current[currentIndexRef.current];
    if (!currentAudio || !startedRef.current) return;

    startedRef.current = false;
    transitioningRef.current = false;
    clearTransitionWatcher();
    fade(currentAudio, currentAudio.volume, 0, FADE_SECONDS, () => {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    });
  }

  function stopPlayback() {
    clearTransitionWatcher();
    cancelFades();
    startedRef.current = false;
    transitioningRef.current = false;

    for (const audio of audiosRef.current) {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 0;
    }
  }

  function clearTransitionWatcher() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function cancelFades() {
    for (const frame of fadeFramesRef.current) {
      window.cancelAnimationFrame(frame);
    }
    fadeFramesRef.current = [];
  }

  function fade(audio: HTMLAudioElement, from: number, to: number, seconds: number, onDone?: () => void) {
    const start = performance.now();
    const duration = seconds * 1000;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      audio.volume = from + (to - from) * progress;

      if (progress < 1) {
        const frame = window.requestAnimationFrame(tick);
        fadeFramesRef.current.push(frame);
      } else {
        onDone?.();
      }
    };

    const frame = window.requestAnimationFrame(tick);
    fadeFramesRef.current.push(frame);
  }

  return null;
}
