import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPanel } from "@/components/ChatPanel";

describe("ChatPanel", () => {
  it("disables chat input and send button when an external disabled prop is true", () => {
    render(<ChatPanel onResults={vi.fn()} externalTrigger={null} disabled={true} />);

    expect(screen.getByPlaceholderText(/ask about hotel preferences/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("leaves chat input enabled when disabled is false (or omitted) and no turn is in flight", () => {
    render(<ChatPanel onResults={vi.fn()} externalTrigger={null} />);

    expect(screen.getByPlaceholderText(/ask about hotel preferences/i)).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });
});
