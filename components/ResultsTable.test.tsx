import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultsTable } from "@/components/ResultsTable";
import type { FlightOffer, HotelOffer } from "@/types/travel";

const flight: FlightOffer = {
  id: "1",
  airline: "Delta Air Lines",
  carrierCode: "DL",
  flightNumber: "204",
  origin: "JFK",
  destination: "LAX",
  departureDateTime: "2026-11-03T08:00:00",
  arrivalDateTime: "2026-11-03T11:20:00",
  returnDepartureDateTime: "2026-11-10T13:00:00",
  returnArrivalDateTime: "2026-11-10T21:15:00",
  stops: 0,
  durationMinutes: 380,
  priceUSD: 412.5,
  cabinClass: "ECONOMY",
  bookingLink: { url: "https://delta.com", isDirect: true, note: "" },
};

const hotel: HotelOffer = {
  id: "H1",
  name: "Downtown LA Hotel",
  chainCode: "HL",
  starRating: 4,
  address: "123 Main St, Los Angeles",
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  pricePerNightUSD: 88.57,
  totalPriceUSD: 620,
  bookingLink: { url: "https://hilton.com", isDirect: true, note: "" },
};

describe("ResultsTable", () => {
  it("shows flights by default and toggles to hotels", () => {
    render(<ResultsTable flights={[flight]} hotels={[hotel]} />);
    expect(screen.getByText("Delta Air Lines")).toBeInTheDocument();
    expect(screen.queryByText("Downtown LA Hotel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /hotels/i }));
    expect(screen.getByText("Downtown LA Hotel")).toBeInTheDocument();
  });

  it("always renders the SerpApi and Google results disclosure note", () => {
    render(<ResultsTable flights={[]} hotels={[]} />);
    expect(screen.getByText(/SerpApi via Google Flights and Google Hotels/i)).toBeInTheDocument();
    expect(screen.getByText(/prices and availability may not be real-time/i)).toBeInTheDocument();
    expect(screen.getByText(/OTAs, or fallback Google results/i)).toBeInTheDocument();
  });
});
