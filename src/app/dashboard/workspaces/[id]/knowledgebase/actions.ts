"use server";

import { createClient } from "@supabase/supabase-js";
import { getTenantId } from "@/lib/auth";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
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

    const mime = file.type;
    let type: "doc" | "image" | "video" = "doc";
    if (mime.startsWith("image/")) type = "image";
    else if (mime.startsWith("video/")) type = "video";

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
        extracted_metadata: { publicUrl: urlData.publicUrl },
        status: "ready",
      })
      .select("*")
      .single();

    if (insertError) throw new Error(insertError.message);

    return { success: true, item };
  } catch (err: any) {
    return { success: false, error: err?.message ?? "Upload failed" };
  }
}