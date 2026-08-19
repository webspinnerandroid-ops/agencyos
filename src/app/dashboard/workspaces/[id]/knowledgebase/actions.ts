"use server";

import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";
import { extractDocumentText, mimeTypeForFilename } from "@/lib/media/docx-text";
import { extractPdfText } from "@/lib/media/pdf-text";
import { autoSaveKnowledgebaseFileToDrive } from "@/lib/drive-sync";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Translate Supabase Storage's terse rejections into something the user can
 * act on. "mime type ... is not supported" means the bucket whitelist blocked
 * the file; "The resource was not found" is Supabase's confusing message for
 * an over-limit upload.
 */
function friendlyUploadError(message: string, sizeBytes: number): string {
  const msg = message.toLowerCase();
  if (msg.includes("mime type") && msg.includes("not supported")) {
    return "This file type isn't allowed for uploads yet.";
  }
  if (msg.includes("not found") || msg.includes("resource was not found")) {
    const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
    return `This file is ${mb} MB — it exceeds the upload size limit.`;
  }
  if (msg.includes("payload too large") || msg.includes("too large") || msg.includes("file size")) {
    return "This file exceeds the upload size limit.";
  }
  return message;
}

export async function uploadFile(
  workspaceId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string; item?: any }> {
  try {
    const tenantId = await getTenantId();
    const supabase = getAdminClient();

    const file = formData.get("file") as File;
    const folderId = formData.get("folderId") as string | null;
    const name = (formData.get("name") as string) || file.name;

    if (!file) return { success: false, error: "No file provided" };

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const storagePath = `${tenantId}/workspaces/${workspaceId}/knowledgebase/${Date.now()}_${file.name}`;

    // Browsers can report an empty type for .docx/.pdf, so derive it from the
    // extension when needed — a blank contentType breaks the storage upload.
    const fileExt = file.name.toLowerCase().split(".").pop() ?? "";
    const mime = file.type || mimeTypeForFilename(file.name) || "application/octet-stream";
    let type: "doc" | "image" | "video" = "doc";
    if (mime.startsWith("image/")) type = "image";
    else if (mime.startsWith("video/")) type = "video";

    // Extract readable text so uploaded documents actually feed the AI's
    // knowledge-base context (not just get stored as opaque bytes).
    let extracted = extractDocumentText(file.name, mime, buffer);
    if (!extracted.extracted && (fileExt === "pdf" || mime === "application/pdf")) {
      extracted = extractPdfText(buffer);
    }

    const { error: uploadError } = await supabase.storage
      .from("tenant-assets")
      .upload(storagePath, buffer, {
        contentType: mime,
        upsert: false,
      });

    if (uploadError) throw new Error(uploadError.message);

    const { data: urlData } = supabase.storage
      .from("tenant-assets")
      .getPublicUrl(storagePath);

    const { data: item, error: insertError } = await supabase
      .from("knowledgebase_items")
      .insert({
        tenant_id: tenantId,
        workspace_id: workspaceId,
        folder_id: folderId || null,
        name,
        type,
        original_filename: file.name,
        storage_path: storagePath,
        mime_type: mime,
        file_size: file.size,
        scraped_text: extracted.extracted ? extracted.text.substring(0, 50000) : null,
        extracted_metadata: { publicUrl: urlData.publicUrl, textExtracted: extracted.extracted },
        status: "ready",
      })
      .select("*")
      .single();

    if (insertError) throw new Error(insertError.message);

    // Fire-and-forget Drive mirror when the workspace has auto-save on. The
    // toggle lives on the google_drive connection; failures never fail the
    // upload (the per-item "save to Drive" button covers manual retries).
    void autoSaveKnowledgebaseFileToDrive({
      tenantId,
      workspaceId,
      itemId: item.id,
      storagePath,
      name: file.name,
      mime,
    });

    return { success: true, item };
  } catch (err: any) {
    let sizeBytes = 0;
    try {
      const f = formData.get("file") as File | null;
      if (f) sizeBytes = f.size;
    } catch {
      // ignore
    }
    return { success: false, error: friendlyUploadError(err?.message ?? "Upload failed", sizeBytes) };
  }
}