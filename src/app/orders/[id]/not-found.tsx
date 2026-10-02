import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OrderNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <ReceiptText className="size-10 text-muted-foreground" />
      <h1 className="font-heading text-lg font-semibold">Order not found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This order does not exist or is outside your restaurant. It may have
        been removed.
      </p>
      <Button
        nativeButton={false}
        render={<Link href="/orders" />}
        variant="outline"
        size="sm"
      >
        Back to orders
      </Button>
    </div>
  );
}