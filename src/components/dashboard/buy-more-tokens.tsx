"use client";

import Link from "next/link";
import { Coins } from "lucide-react";

/**
 * Shown when a generation is blocked by the token-billing balance gate
 * (402 + buyMoreTokens). Links straight to the billing page's top-up cards.
 */
export function BuyMoreTokens({ message }: { message?: string }) {
  return (
    <div className="p-4 rounded-md border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-100 text-sm">
      <div className="flex items-start gap-2">
        <Coins className="size-4 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="font-medium">
            {message ?? "Your AI token balance is exhausted."}
          </p>
          <p className="text-xs opacity-80">
            Your monthly allowance and prepaid balance are used up. Add tokens
            (min $20 USD) to keep generating.
          </p>
          <Link
            href="/dashboard/billing"
            className="inline-flex items-center rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 transition-colors"
          >
            Add tokens
          </Link>
        </div>
      </div>
    </div>
  );
}
