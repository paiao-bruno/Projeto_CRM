import { VerticeShell } from "@/components/vertice/shell";
import "./vertice.css";

export default function VerticeLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="vx-root">
      <VerticeShell>{children}</VerticeShell>
    </div>
  );
}
