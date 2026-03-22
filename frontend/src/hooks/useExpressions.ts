import { useEffect, useRef } from "react";
import { RTVIEvent } from "@pipecat-ai/client-js";
import type { PipecatClient } from "@pipecat-ai/client-js";

const FACE_TAG_RE = /\[face:(\w+)\]/g;

/**
 * Listens to RTVIEvent.BotLlmText events directly from the
 * PipecatClient.  Accumulates streamed tokens per turn and
 * matches [face:name] tags when complete.
 *
 * This bypasses usePipecatConversation entirely — it reads
 * from the raw event stream which is guaranteed to fire.
 */
export function useExpressions(
  client: PipecatClient | null,
  onExpression: (name: string) => void,
  revertMs = 4000
) {
  const bufRef = useRef("");
  const lastFaceRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!client) return;

    const onText = (data: { text: string }) => {
      bufRef.current += data.text;
      console.log("[useExpressions] token:", JSON.stringify(data.text), "buf:", bufRef.current);

      // Check for complete face tags in the accumulated buffer
      const matches = [...bufRef.current.matchAll(FACE_TAG_RE)];
      if (matches.length > 0) {
        const face = matches[matches.length - 1][1];
        if (face !== lastFaceRef.current) {
          lastFaceRef.current = face;
          console.log("[useExpressions] EXPRESSION:", face);
          onExpression(face);

          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => {
            onExpression("neutral");
            lastFaceRef.current = null;
          }, revertMs);
        }
      }
    };

    const onStopped = () => {
      console.log("[useExpressions] LLM turn ended, buf was:", bufRef.current);
      bufRef.current = "";
    };

    client.on(RTVIEvent.BotLlmText, onText);
    client.on(RTVIEvent.BotLlmStopped, onStopped);

    return () => {
      client.off(RTVIEvent.BotLlmText, onText);
      client.off(RTVIEvent.BotLlmStopped, onStopped);
    };
  }, [client, onExpression, revertMs]);
}
