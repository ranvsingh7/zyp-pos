import { LoaderCircle } from "lucide-react";

export default function PosLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center bg-background">
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading POS</span>
    </div>
  );
}
