import { useEffect, useRef } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import type { PipecatClient } from "@pipecat-ai/client-js";
import type { Emotion } from "../lib/animation/AnimationController";

const FACE_TAG_RE = /\[face:(\w+)\]/g;

const TAG_TO_EMOTION: Record<string, Emotion> = {
  joy: "happy",
  happy: "happy",
  angry: "angry",
  fun: "funny",
  funny: "funny",
};

export function useExpressions(
  client: PipecatClient | null,
  onExpression: (name: string) => void,
  onEmotion: (emotion: Emotion) => void,
  revertMs = 4000
) {
  const bufRef = useRef("");
  const lastFaceRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!client) return;

    const onText = (data: { text: string }) => {
      bufRef.current += data.text;

      const matches = [...bufRef.current.matchAll(FACE_TAG_RE)];
      if (matches.length > 0) {
        const face = matches[matches.length - 1][1];
        if (face !== lastFaceRef.current) {
          lastFaceRef.current = face;
          onExpression(face);

          const emotion = TAG_TO_EMOTION[face];
          if (emotion) onEmotion(emotion);

          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            onExpression("neutral");
            lastFaceRef.current = null;
          }, revertMs);
        }
      }
    };

    const onStopped = () => {
      bufRef.current = "";
    };

    client.on(RTVIEvent.BotLlmText, onText);
    client.on(RTVIEvent.BotLlmStopped, onStopped);

    return () => {
      client.off(RTVIEvent.BotLlmText, onText);
      client.off(RTVIEvent.BotLlmStopped, onStopped);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [client, onExpression, onEmotion, revertMs]);
}
