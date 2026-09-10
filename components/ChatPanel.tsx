"use client";

import { useState } from "react";
import type { FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

interface ChatPanelProps {
  onResults: (flights: FlightOffer[], hotels: HotelOffer[]) => void;
  externalTrigger: TripFormInput | null;
}

interface DisplayMessage {
  role: "user" | "assistant" | "status";
  text: string;
}

export function ChatPanel({ onResults, externalTrigger }: ChatPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendTurn(body: { message?: string; formData?: TripFormInput }) {
    setBusy(true);
    if (body.message) setMessages((m) => [...m, { role: "user", text: body.message! }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        if (payload.type === "status") {
          setMessages((m) => [...m, { role: "status", text: payload.text }]);
        } else if (payload.type === "final") {
          setMessages((m) => [...m, { role: "assistant", text: payload.text }]);
          onResults(payload.flights, payload.hotels);
        } else if (payload.type === "error") {
          setMessages((m) => [...m, { role: "assistant", text: `Error: ${payload.text}` }]);
        }
      }
    }
    setBusy(false);
  }

  function handleSend() {
    if (!input.trim() || busy) return;
    const message = input;
    setInput("");
    void sendTurn({ message });
  }

  // externalTrigger is set by the parent right after a form submit; the parent
  // is responsible for calling sendTurn with formData once and clearing it —
  // wired in app/page.tsx (Step 12).

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflow: "auto" }}>
        {messages.map((m, i) => (
          <p key={i} style={{ opacity: m.role === "status" ? 0.6 : 1 }}>
            <strong>{m.role}:</strong> {m.text}
          </p>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask about hotel preferences, budget, or refine results…"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button onClick={handleSend} disabled={busy}>
          Send
        </button>
      </div>
    </div>
  );
}
