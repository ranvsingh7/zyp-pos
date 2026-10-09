import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoaderCircle className="size-8 animate-spin text-primary" aria-hidden="true" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
