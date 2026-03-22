import { useRef, useCallback } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
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

  // Lip-sync: read WavStreamPlayer's analyser from the transport
  const onMouth = useCallback((v: number) => vrmRef.current?.setMouthValue(v), []);
  useLipSync(pipecatClient, onMouth);

  // Expressions: listen to BotLlmText events for [face:name] tags
  const onExpr = useCallback((n: string) => vrmRef.current?.setExpression(n), []);
  useExpressions(pipecatClient, onExpr);

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

  // Latest message for the subtitle bar
  const lastMsg = messages[messages.length - 1];
  const lastText = lastMsg?.parts
    ?.map((p) =>
      isBotText(p.text) ? p.text.spoken + (p.text.unspoken ?? "") : String(p.text ?? "")
    )
    .join("") ?? "";
  const lastRole = lastMsg?.role ?? "";

  return (
    <>
      <VRMScene ref={vrmRef} />

      <div className="title-bar">CareXR</div>

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
