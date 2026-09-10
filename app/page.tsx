"use client";

import { useState } from "react";
import { ResizablePanels } from "@/components/ResizablePanels";
import { TripForm } from "@/components/TripForm";
import { ChatPanel } from "@/components/ChatPanel";
import { ResultsTable } from "@/components/ResultsTable";
import type { FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

export default function HomePage() {
  const [flights, setFlights] = useState<FlightOffer[]>([]);
  const [hotels, setHotels] = useState<HotelOffer[]>([]);
  const [formSubmitCount, setFormSubmitCount] = useState(0);
  const [pendingForm, setPendingForm] = useState<TripFormInput | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  async function handleFormSubmit(data: TripFormInput) {
    setFormBusy(true);
    setPendingForm(data);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formData: data }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n").filter(Boolean);
      buffer = "";
      for (const line of lines) {
        const payload = JSON.parse(line);
        if (payload.type === "final") {
          setFlights(payload.flights);
          setHotels(payload.hotels);
        }
      }
    }
    setFormBusy(false);
    setFormSubmitCount((c) => c + 1);
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
              key={formSubmitCount}
              externalTrigger={pendingForm}
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
