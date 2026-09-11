"use client";

import { useState } from "react";
import type { FlightOffer, HotelOffer } from "@/types/travel";

interface ResultsTableProps {
  flights: FlightOffer[];
  hotels: HotelOffer[];
}

export function ResultsTable({ flights, hotels }: ResultsTableProps) {
  const [tab, setTab] = useState<"flights" | "hotels">("flights");

  return (
    <div>
      <p style={{ fontSize: 12, color: "#666" }}>
        Results come from SerpApi via Google Flights and Google Hotels. Prices and availability may
        not be real-time, and booking links may lead to airline or hotel sites, OTAs, or fallback
        Google results.
      </p>
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button role="tab" aria-selected={tab === "flights"} onClick={() => setTab("flights")}>
          Flights
        </button>
        <button role="tab" aria-selected={tab === "hotels"} onClick={() => setTab("hotels")}>
          Hotels
        </button>
      </div>

      {tab === "flights" && (
        <table>
          <thead>
            <tr>
              <th>Airline</th>
              <th>Flight</th>
              <th>Stops</th>
              <th>Price (USD)</th>
              <th>Book</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.id}>
                <td>{f.airline}</td>
                <td>{f.carrierCode}{f.flightNumber}</td>
                <td>{f.stops}</td>
                <td>${f.priceUSD.toFixed(2)}</td>
                <td>
                  <a href={f.bookingLink.url} target="_blank" rel="noreferrer">
                    {f.bookingLink.isDirect ? "Book" : "View options"}
                  </a>
                  {f.bookingLink.note && <div style={{ fontSize: 11, color: "#888" }}>{f.bookingLink.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "hotels" && (
        <table>
          <thead>
            <tr>
              <th>Hotel</th>
              <th>Stars</th>
              <th>$/night</th>
              <th>Total (USD)</th>
              <th>Book</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.id}>
                <td>{h.name}</td>
                <td>{h.starRating ?? "—"}</td>
                <td>${h.pricePerNightUSD.toFixed(2)}</td>
                <td>${h.totalPriceUSD.toFixed(2)}</td>
                <td>
                  <a href={h.bookingLink.url} target="_blank" rel="noreferrer">
                    {h.bookingLink.isDirect ? "Book" : "View options"}
                  </a>
                  {h.bookingLink.note && <div style={{ fontSize: 11, color: "#888" }}>{h.bookingLink.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
