import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatPanel } from "@/components/ChatPanel";

describe("ChatPanel", () => {
  it("disables chat input and send button when an external disabled prop is true", () => {
    render(<ChatPanel onResults={vi.fn()} messages={[]} onAppend={vi.fn()} disabled={true} />);

    expect(screen.getByPlaceholderText(/ask about hotel preferences/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });

  it("leaves chat input enabled when disabled is false (or omitted) and no turn is in flight", () => {
    render(<ChatPanel onResults={vi.fn()} messages={[]} onAppend={vi.fn()} />);

    expect(screen.getByPlaceholderText(/ask about hotel preferences/i)).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /send/i })).not.toBeDisabled();
  });

  it("renders messages passed in via the lifted messages prop", () => {
    render(
      <ChatPanel
        onResults={vi.fn()}
        messages={[
          { role: "user", text: "hello" },
          { role: "assistant", text: "hi there" },
        ]}
        onAppend={vi.fn()}
      />
    );

    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });
});
