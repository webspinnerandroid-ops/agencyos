import { createServiceClient } from "@/lib/supabase/server";
import { renderBlockHtml, CMS_STYLES, type CmsBlock } from "@/lib/cms";

/**
 * Public CMS renderer — /site/<slug>.
 * Renders a published page's blocks. Unpublished pages 404 publicly.
 * Blocks render via the allowlisted renderers (no raw model HTML).
 */
export default async function SitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createServiceClient();

  const { data: page, error } = await supabase
    .from("site_pages")
    .select("id, title, blocks, is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error || !page) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: 60, textAlign: "center", color: "#666" }}>
        <h1>Page not found</h1>
        <p>This page does not exist or has not been published yet.</p>
      </div>
    );
  }

  const blocks = (Array.isArray(page.blocks) ? page.blocks : []) as CmsBlock[];
  const html = blocks.map((b) => renderBlockHtml(b, page.id)).join("\n");

  return (
    <html>
      <head>
        <title>{page.title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style dangerouslySetInnerHTML={{ __html: CMS_STYLES }} />
      </head>
      <body style={{ margin: 0, background: "#fff" }}>
        <div className="cms-shell">
          <div dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        {/* Form widgets submit via fetch so the page doesn't navigate away. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
document.addEventListener('submit', (e) => {
  const f = e.target;
  if (!f.classList.contains('cms-form')) return;
  e.preventDefault();
  const status = f.querySelector('.cms-form-status');
  const data = new FormData(f);
  data.set('page_id', f.dataset.page || '');
  data.set('block_id', f.dataset.block || '');
  fetch(f.getAttribute('action') || '/api/cms/forms', { method: 'POST', body: data })
    .then(r => r.json().catch(() => ({})))
    .then(d => { if (status) { status.className = 'cms-form-status ' + (d.success ? 'ok' : 'err'); status.textContent = d.success ? d.message : (d.error || 'Something went wrong.'); } })
    .catch(() => { if (status) { status.className = 'cms-form-status err'; status.textContent = 'Network error.'; } });
});
`,
          }}
        />
      </body>
    </html>
  );
}
