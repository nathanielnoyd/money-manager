import { Compass } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState icon={Compass} title="That page doesn't exist">
      <p>It may have been removed, or the link may be wrong.</p>
      <Button variant="outline" className="mt-4" asChild>
        <Link href="/">Back to the dashboard</Link>
      </Button>
    </EmptyState>
  );
}
