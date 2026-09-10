import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TripForm } from "@/components/TripForm";

describe("TripForm", () => {
  it("calls onSubmit with structured trip data when the form is submitted", () => {
    const onSubmit = vi.fn();
    render(<TripForm onSubmit={onSubmit} disabled={false} />);

    fireEvent.change(screen.getByLabelText(/origin/i), { target: { value: "JFK" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "LAX" } });
    fireEvent.change(screen.getByLabelText(/departure date/i), { target: { value: "2026-11-03" } });
    fireEvent.change(screen.getByLabelText(/return date/i), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText(/travelers/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/cabin class/i), { target: { value: "BUSINESS" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 2,
      cabinClass: "BUSINESS",
    });
  });

  it("disables the submit button while disabled=true", () => {
    render(<TripForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByRole("button", { name: /search/i })).toBeDisabled();
  });
});
