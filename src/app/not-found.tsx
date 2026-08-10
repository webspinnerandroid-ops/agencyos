import Link from "next/link";
import { Brain, ArrowLeft, Home } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex items-center gap-2 mb-6">
        <Brain className="size-8 text-primary" />
        <span className="text-2xl font-bold tracking-tight">Agency OS</span>
      </div>
      <p className="text-sm font-semibold text-primary uppercase tracking-widest">404</p>
      <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-2">Page not found</h1>
      <p className="mt-4 text-muted-foreground max-w-md">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="mt-8 flex items-center gap-3 flex-wrap justify-center">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Home className="size-4" /> Go to Dashboard
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          <ArrowLeft className="size-4" /> Back to Home
        </Link>
      </div>
    </div>
  );
}