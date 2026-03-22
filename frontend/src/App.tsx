import { useRef, useState, useCallback, useEffect } from "react";
import { PipecatClient, RTVIEvent } from "@pipecat-ai/client-js";
import {
  PipecatClientProvider,
  PipecatClientAudio,
  usePipecatClient,
  usePipecatConversation,
  type BotOutputText,
} from "@pipecat-ai/client-react";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";
import VRMScene, { type VRMSceneHandle } from "./components/VRMScene";
import { useLipSync } from "./hooks/useLipSync";
import { useExpressions } from "./hooks/useExpressions";
import type { Emotion } from "./lib/animation/AnimationController";
import "./App.css";

const client = new PipecatClient({
  transport: new WebSocketTransport(),
  enableMic: true,
});

function App() {
  return (
    <PipecatClientProvider client={client}>
      <AvatarUI />
      <PipecatClientAudio />
    </PipecatClientProvider>
  );
}

function isBotText(t: unknown): t is BotOutputText {
  return typeof t === "object" && t !== null && "spoken" in t;
}

function AvatarUI() {
  const pipecatClient = usePipecatClient() ?? null;
  const { messages = [] } = usePipecatConversation() ?? {};
  const vrmRef = useRef<VRMSceneHandle>(null);

  const backendUrl = import.meta.env.VITE_PIPECAT_API_URL;
  const wsUrl = backendUrl?.replace(/^http/, "ws") + "/ws";

  // Track talking state from TTS audio
  const isTalkingRef = useRef(false);
  const currentEmotionRef = useRef<Emotion>("neutral");

  const onMouth = useCallback((v: number) => {
    vrmRef.current?.setMouthValue(v);

    const speaking = v > 0.05;
    if (speaking && !isTalkingRef.current) {
      isTalkingRef.current = true;
      vrmRef.current?.startTalking(currentEmotionRef.current);
    }
  }, []);
  useLipSync(pipecatClient, onMouth);

  // Detect when TTS stops → transition back to idle
  useEffect(() => {
    if (!pipecatClient) return;

    const onTtsStopped = () => {
      isTalkingRef.current = false;
      vrmRef.current?.stopTalking();
    };

    pipecatClient.on(RTVIEvent.BotTtsStopped, onTtsStopped);
    return () => {
      pipecatClient.off(RTVIEvent.BotTtsStopped, onTtsStopped);
    };
  }, [pipecatClient]);

  // Expressions + emotion for animation switching
  const onExpr = useCallback(
    (n: string) => vrmRef.current?.setExpression(n),
    []
  );
  const onEmotion = useCallback((e: Emotion) => {
    currentEmotionRef.current = e;
  }, []);
  useExpressions(pipecatClient, onExpr, onEmotion);

  // Poll backend for 3D generation status
  const [isProcessing, setIsProcessing] = useState(false);
  const [readyModel, setReadyModel] = useState<{
    glb_url: string;
    prompt: string;
  } | null>(null);
  const lastSeenUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!backendUrl) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${backendUrl}/latest-model`);
        const data = await res.json();

        const generating = !!data.generating;
        setIsProcessing((prev) => {
          if (prev !== generating) vrmRef.current?.setProcessing(generating);
          return generating;
        });

        if (
          data.status === "ready" &&
          data.glb_url !== lastSeenUrlRef.current
        ) {
          lastSeenUrlRef.current = data.glb_url;
          setReadyModel({ glb_url: data.glb_url, prompt: data.prompt });
        }
      } catch {
        /* backend not ready yet */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [backendUrl]);

  const handleConnect = async () => {
    try {
      await pipecatClient?.connect({ wsUrl });
    } catch (err) {
      console.error("Connection failed:", err);
    }
  };

  const handleDisconnect = async () => {
    try {
      await pipecatClient?.disconnect();
    } catch (err) {
      console.error("Disconnect failed:", err);
    }
  };

  const lastMsg = messages[messages.length - 1];
  const lastText =
    lastMsg?.parts
      ?.map((p) =>
        isBotText(p.text)
          ? p.text.spoken + (p.text.unspoken ?? "")
          : String(p.text ?? "")
      )
      .join("") ?? "";
  const lastRole = lastMsg?.role ?? "";

  return (
    <>
      <VRMScene ref={vrmRef} />
      {isProcessing && (
        <>
          <div className="creating-glow" />
          <div className="creating-status">
            <span>Creating your model...</span>
          </div>
        </>
      )}

      <div className="title-bar">CareXR</div>

      {readyModel && (
        <div className="model-ready">
          <a
            href={readyModel.glb_url}
            download={`${readyModel.prompt.slice(0, 30).replace(/\s+/g, "_")}.glb`}
            className="model-ready-btn"
          >
            Download your 3D model
          </a>
          <button
            className="model-ready-dismiss"
            onClick={() => setReadyModel(null)}
          >
            &times;
          </button>
        </div>
      )}

      {lastText && (
        <div className="subtitle-bar">
          <span className={`speaker ${lastRole}`}>
            {lastRole === "assistant" ? "AI" : "You"}
          </span>
          <span className="text">
            {lastText.replace(/\[face:\w+\]\s*/g, "")}
          </span>
        </div>
      )}

      <div className="controls">
        {!backendUrl && (
          <div className="warn">VITE_PIPECAT_API_URL not set</div>
        )}
        <button className="btn-primary" onClick={handleConnect}>
          Start
        </button>
        <button className="btn-secondary" onClick={handleDisconnect}>
          Stop
        </button>
      </div>
    </>
  );
}

export default App;
