"use client";

import { useState } from "react";
import type { DisplayMessage, FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";
import { runChatTurn } from "@/lib/chat/runChatTurn";

interface ChatPanelProps {
  onResults: (flights: FlightOffer[], hotels: HotelOffer[]) => void;
  // Messages are lifted into app/page.tsx so both this panel's own chat-initiated
  // turns and the parent's form-submitted turns render into the SAME transcript,
  // without remounting (and clearing) this component on every form submit.
  messages: DisplayMessage[];
  onAppend: (message: DisplayMessage) => void;
  // Set by the parent while a form-submitted search is in flight, so the spec's
  // "further chat input is disabled until the agent's response completes" rule
  // holds for BOTH trigger paths (form submit and chat send), not just this
  // panel's own internal `busy` state. ORed with `busy` below.
  disabled?: boolean;
}

export function ChatPanel({ onResults, messages, onAppend, disabled = false }: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const effectiveDisabled = busy || disabled;

  async function sendTurn(body: { message?: string; formData?: TripFormInput }) {
    setBusy(true);
    if (body.message) onAppend({ role: "user", text: body.message });

    try {
      await runChatTurn(body, {
        onStatus: (text) => onAppend({ role: "status", text }),
        onFinal: (text, flights, hotels) => {
          onAppend({ role: "assistant", text });
          onResults(flights, hotels);
        },
        onError: (text) => onAppend({ role: "assistant", text: `Error: ${text}` }),
      });
    } finally {
      // try/finally guarantees busy is always cleared, even if runChatTurn's own
      // internal error handling still leaves something unexpected uncaught.
      setBusy(false);
    }
  }

  function handleSend() {
    if (!input.trim() || effectiveDisabled) return;
    const message = input;
    setInput("");
    void sendTurn({ message });
  }

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
          disabled={effectiveDisabled}
          placeholder="Ask about hotel preferences, budget, or refine results…"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button onClick={handleSend} disabled={effectiveDisabled}>
          Send
        </button>
      </div>
    </div>
  );
}
