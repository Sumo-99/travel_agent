"use client";

import { useState, type FormEvent } from "react";
import type { CabinClass, TripFormInput } from "@/types/travel";

interface TripFormProps {
  onSubmit: (data: TripFormInput) => void;
  disabled: boolean;
}

export function TripForm({ onSubmit, disabled }: TripFormProps) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [travelers, setTravelers] = useState(1);
  const [cabinClass, setCabinClass] = useState<CabinClass>("ECONOMY");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ origin, destination, departureDate, returnDate, travelers, cabinClass });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label>
        Origin
        <input value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())} required maxLength={3} />
      </label>
      <label>
        Destination
        <input value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} required maxLength={3} />
      </label>
      <label>
        Departure date
        <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} required />
      </label>
      <label>
        Return date
        <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
      </label>
      <label>
        Travelers
        <input
          type="number"
          min={1}
          value={travelers}
          onChange={(e) => setTravelers(Number(e.target.value))}
          required
        />
      </label>
      <label>
        Cabin class
        <select value={cabinClass} onChange={(e) => setCabinClass(e.target.value as CabinClass)}>
          <option value="ECONOMY">Economy</option>
          <option value="PREMIUM_ECONOMY">Premium Economy</option>
          <option value="BUSINESS">Business</option>
          <option value="FIRST">First</option>
        </select>
      </label>
      <button type="submit" disabled={disabled}>
        Search
      </button>
    </form>
  );
}
