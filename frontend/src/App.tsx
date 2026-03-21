// import { useState } from 'react'
// import reactLogo from './assets/react.svg'
// import viteLogo from './assets/vite.svg'
// import heroImg from './assets/hero.png'
// import './App.css'

// function App() {
//   const [count, setCount] = useState(0)

//   return (
//     <>
//       <section id="center">
//         <div className="hero">
//           <img src={heroImg} className="base" width="170" height="179" alt="" />
//           <img src={reactLogo} className="framework" alt="React logo" />
//           <img src={viteLogo} className="vite" alt="Vite logo" />
//         </div>
//         <div>
//           <h1>Get started</h1>
//           <p>
//             Edit <code>src/App.tsx</code> and save to test <code>HMR</code>
//           </p>
//         </div>
//         <button
//           className="counter"
//           onClick={() => setCount((count) => count + 1)}
//         >
//           Count is {count}
//         </button>
//       </section>

//       <div className="ticks"></div>

//       <section id="next-steps">
//         <div id="docs">
//           <svg className="icon" role="presentation" aria-hidden="true">
//             <use href="/icons.svg#documentation-icon"></use>
//           </svg>
//           <h2>Documentation</h2>
//           <p>Your questions, answered</p>
//           <ul>
//             <li>
//               <a href="https://vite.dev/" target="_blank">
//                 <img className="logo" src={viteLogo} alt="" />
//                 Explore Vite
//               </a>
//             </li>
//             <li>
//               <a href="https://react.dev/" target="_blank">
//                 <img className="button-icon" src={reactLogo} alt="" />
//                 Learn more
//               </a>
//             </li>
//           </ul>
//         </div>
//         <div id="social">
//           <svg className="icon" role="presentation" aria-hidden="true">
//             <use href="/icons.svg#social-icon"></use>
//           </svg>
//           <h2>Connect with us</h2>
//           <p>Join the Vite community</p>
//           <ul>
//             <li>
//               <a href="https://github.com/vitejs/vite" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#github-icon"></use>
//                 </svg>
//                 GitHub
//               </a>
//             </li>
//             <li>
//               <a href="https://chat.vite.dev/" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#discord-icon"></use>
//                 </svg>
//                 Discord
//               </a>
//             </li>
//             <li>
//               <a href="https://x.com/vite_js" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#x-icon"></use>
//                 </svg>
//                 X.com
//               </a>
//             </li>
//             <li>
//               <a href="https://bsky.app/profile/vite.dev" target="_blank">
//                 <svg
//                   className="button-icon"
//                   role="presentation"
//                   aria-hidden="true"
//                 >
//                   <use href="/icons.svg#bluesky-icon"></use>
//                 </svg>
//                 Bluesky
//               </a>
//             </li>
//           </ul>
//         </div>
//       </section>

//       <div className="ticks"></div>
//       <section id="spacer"></section>
//     </>
//   )
// }

// export default App
import { PipecatClient } from "@pipecat-ai/client-js";
import {
  PipecatClientProvider,
  PipecatClientAudio,
  usePipecatClient,
  usePipecatConversation,
  type BotOutputText,
} from "@pipecat-ai/client-react";
import { WebSocketTransport } from "@pipecat-ai/websocket-transport";

// Create the client instance
const client = new PipecatClient({
  transport: new WebSocketTransport(),
  enableMic: true,
});

// Root component wraps the app with the provider
function App() {
  return (
    <PipecatClientProvider client={client}>
      <VoiceBot />
      <PipecatClientAudio />
    </PipecatClientProvider>
  );
}

function isBotOutputText(text: unknown): text is BotOutputText {
  return typeof text === "object" && text !== null && "spoken" in text;
}

// Component using the client and conversation hooks
function VoiceBot() {
  const pipecatClient = usePipecatClient();
  const { messages } = usePipecatConversation();

  const backendUrl = import.meta.env.VITE_PIPECAT_API_URL;
  const wsUrl = backendUrl?.replace(/^http/, "ws") + "/ws";

  const handleClick = async () => {
    try {
      await pipecatClient?.connect({
        wsUrl,
      });
    } catch (err) {
      console.error("Connection failed:", err);
    }
  };

  return (
    <div>
      <div style={{ padding: "10px", marginBottom: "10px", background: backendUrl ? "#e6ffe6" : "#ffe6e6", borderRadius: "6px", fontFamily: "monospace", fontSize: "13px" }}>
        <div><strong>Backend URL:</strong> {backendUrl || "NOT SET (undefined)"}</div>
        <div><strong>WebSocket:</strong> {wsUrl}</div>
      </div>
      <button onClick={handleClick}>Start Conversation</button>
      <ul>
        {messages.map((msg, i) => (
          <li key={`${msg.createdAt}-${i}`}>
            <strong>{msg.role}:</strong>{" "}
            {msg.parts?.map((part, j) => (
              <span key={j}>
                {isBotOutputText(part.text)
                  ? `${part.text.spoken}${part.text.unspoken}`
                  : part.text}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
export default App