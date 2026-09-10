// components/ResizablePanels.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResizablePanels } from "@/components/ResizablePanels";

describe("ResizablePanels", () => {
  it("renders both left and right content", () => {
    render(
      <ResizablePanels
        left={<div>form-content</div>}
        right={<div>chat-content</div>}
      />
    );
    expect(screen.getByText("form-content")).toBeInTheDocument();
    expect(screen.getByText("chat-content")).toBeInTheDocument();
  });

  it("exposes a drag handle for resizing", () => {
    render(<ResizablePanels left={<div />} right={<div />} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
