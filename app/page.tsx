"use client";

import { useState } from "react";
import { ResizablePanels } from "@/components/ResizablePanels";
import { TripForm } from "@/components/TripForm";
import { ChatPanel } from "@/components/ChatPanel";
import { ResultsTable } from "@/components/ResultsTable";
import { runChatTurn } from "@/lib/chat/runChatTurn";
import type { DisplayMessage, FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

export default function HomePage() {
  const [flights, setFlights] = useState<FlightOffer[]>([]);
  const [hotels, setHotels] = useState<HotelOffer[]>([]);
  const [formBusy, setFormBusy] = useState(false);
  // Lifted out of ChatPanel so both form-submitted and chat-initiated turns append to
  // the same transcript — this is what fixes the "form submit produces no chat output
  // and wipes prior history" defect. ChatPanel no longer owns this state or remounts.
  const [messages, setMessages] = useState<DisplayMessage[]>([]);

  function appendMessage(message: DisplayMessage) {
    setMessages((prev) => [...prev, message]);
  }

  async function handleFormSubmit(data: TripFormInput) {
    setFormBusy(true);
    try {
      await runChatTurn(
        { formData: data },
        {
          onStatus: (text) => appendMessage({ role: "status", text }),
          onFinal: (text, newFlights, newHotels) => {
            appendMessage({ role: "assistant", text });
            setFlights(newFlights);
            setHotels(newHotels);
          },
          onError: (text) => appendMessage({ role: "assistant", text: `Error: ${text}` }),
        }
      );
    } finally {
      setFormBusy(false);
    }
  }

  return (
    <main style={{ height: "100vh" }}>
      <ResizablePanels
        left={
          <div style={{ padding: 16 }}>
            <TripForm onSubmit={handleFormSubmit} disabled={formBusy} />
            <div style={{ marginTop: 16 }}>
              <ResultsTable flights={flights} hotels={hotels} />
            </div>
          </div>
        }
        right={
          <div style={{ padding: 16, height: "100%" }}>
            <ChatPanel
              messages={messages}
              onAppend={appendMessage}
              disabled={formBusy}
              onResults={(f, h) => {
                setFlights(f);
                setHotels(h);
              }}
            />
          </div>
        }
      />
    </main>
  );
}
