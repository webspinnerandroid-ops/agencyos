import Link from "next/link";
import { notFound } from "next/navigation";
import { getLandingContent } from "@/lib/landing-content-server";
import { renderBlogBody } from "@/lib/blog-render";

export const dynamic = "force-dynamic";

/**
 * Super-admin marketing pages created in the Page Builder. Renders the page's
 * title + body (markdown via the XSS-safe renderBlogBody) at /p/<slug>.
 */
export default async function MarketingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const content = await getLandingContent();
  const page = content.pages.find((p) => p.slug === slug);
  if (!page) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight mb-6">{page.title}</h1>
        <div
          className="prose prose-sm max-w-none [&_p]:my-3 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-6 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6"
          dangerouslySetInnerHTML={{ __html: renderBlogBody(page.body) }}
        />
      </main>
    </div>
  );
}
