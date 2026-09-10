import { ResizablePanels } from "@/components/ResizablePanels";

export default function HomePage() {
  return (
    <main style={{ height: "100vh" }}>
      <ResizablePanels
        left={<div id="form-slot" style={{ padding: 16 }}>Form goes here (Task 5)</div>}
        right={<div id="chat-slot" style={{ padding: 16 }}>Chat goes here (Task 5)</div>}
      />
    </main>
  );
}
