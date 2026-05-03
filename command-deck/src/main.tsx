import React from "react";
import ReactDOM from "react-dom/client";
import "mapbox-gl/dist/mapbox-gl.css";
import { PipecatClient } from "@pipecat-ai/client-js";
import { PipecatClientAudio, PipecatClientProvider } from "@pipecat-ai/client-react";
import { DailyTransport } from "@pipecat-ai/daily-transport";

import { App } from "./App";
import "./styles.css";

const pipecatClient = new PipecatClient({
  transport: new DailyTransport({ bufferLocalAudioUntilBotReady: true }),
  enableCam: false,
  enableMic: false
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PipecatClientProvider client={pipecatClient}>
      <PipecatClientAudio />
      <App />
    </PipecatClientProvider>
  </React.StrictMode>
);
