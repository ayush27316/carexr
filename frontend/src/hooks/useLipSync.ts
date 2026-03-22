import { useEffect, useRef, useCallback } from "react";
import type { PipecatClient } from "@pipecat-ai/client-js";

/**
 * Reads audio analysis data from the Pipecat WebSocket transport's
 * internal WavStreamPlayer analyser.  This is the same analyser the
 * transport creates when it calls WavStreamPlayer.connect().
 *
 * Access path: client.transport → _mediaManager → _wavStreamPlayer → analyser
 */
export function useLipSync(
  client: PipecatClient | null,
  onMouthValue: (value: number) => void
) {
  const rafRef = useRef(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const rms = sum / data.length / 255;
      onMouthValue(Math.min(1, rms * 3.5));
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [onMouthValue]);

  useEffect(() => {
    // Poll for the analyser since it's only created after transport connects
    const interval = setInterval(() => {
      if (analyserRef.current) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transport = (client as any)?.transport;
        const mm =
          transport?._mediaManager ?? transport?.mediaManager;
        const player =
          mm?._wavStreamPlayer ?? mm?.wavStreamPlayer;
        if (player?.analyser) {
          analyserRef.current = player.analyser;
          rafRef.current = requestAnimationFrame(tick);
          clearInterval(interval);
        }
      } catch {
        // Transport not ready yet
      }
    }, 300);

    return () => {
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
      analyserRef.current = null;
    };
  }, [client, tick]);
}
