"use server";

import { revalidatePath } from "next/cache"
import { createClient } from "@supabase/supabase-js"
import { getTenantId } from "@/lib/auth"

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface TenantSettings {
  name: string | null
  slug: string | null
  logoUrl: string | null
  primaryColor: string
  customDomain: string | null
}

export interface ActionResponse<T = void> {
  success: boolean
  data?: T
  error?: string
}

// ------------------------------------------------------------------
// Read current tenant settings
// ------------------------------------------------------------------

export async function getTenantSettings(): Promise<
  ActionResponse<TenantSettings>
> {
  try {
    const tenantId = await getTenantId()
    const supabase = getAdminClient()

    const { data, error } = await supabase
      .from("tenants")
      .select("name, slug, logo_url, primary_color, custom_domain")
      .eq("id", tenantId)
      .single()

    if (error) throw new Error(error.message)

    return {
      success: true,
      data: {
        name: data.name ?? null,
        slug: data.slug ?? null,
        logoUrl: data.logo_url ?? null,
        primaryColor: data.primary_color ?? "#2563eb",
        customDomain: data.custom_domain ?? null,
      },
    }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ------------------------------------------------------------------
// Update tenant branding settings
// ------------------------------------------------------------------

export async function updateTenantSettings(
  input: {
    primaryColor?: string
    customDomain?: string
  }
): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId()
    const supabase = getAdminClient()

    const updates: Record<string, string | null> = {}
    if (input.primaryColor !== undefined) {
      updates.primary_color = input.primaryColor
    }
    if (input.customDomain !== undefined) {
      updates.custom_domain = input.customDomain || null
      // Strip protocol / trailing slash for storage
      if (updates.custom_domain) {
        updates.custom_domain = updates.custom_domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "")
      }
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: "No fields to update." }
    }

    const { error } = await supabase
      .from("tenants")
      .update(updates)
      .eq("id", tenantId)

    if (error) throw new Error(error.message)

    revalidatePath("/dashboard/settings/white-label")

    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ------------------------------------------------------------------
// Upload logo to Supabase Storage and update the tenants row
// ------------------------------------------------------------------

/**
 * Upload a logo image (as a base64 data-URI or as a File → Buffer on the
 * server). The client sends the file bytes as a base64 string + original
 * filename. We upload into the "tenant-assets" bucket, prefixing with the
 * tenant ID so each tenant's files are isolated.
 */
export async function uploadLogo(
  base64Data: string,
  fileName: string
): Promise<ActionResponse<{ logoUrl: string }>> {
  try {
    const tenantId = await getTenantId()
    const supabase = getAdminClient()

    // Decode base64 → Buffer
    const parts = base64Data.split(",")
    const raw = parts.length === 2 ? parts[1] : base64Data
    const buffer = Buffer.from(raw, "base64")

    // Determine file extension
    const ext = fileName.split(".").pop() ?? "png"
    const storagePath = `${tenantId}/logo.${ext}`

    // Upload to Supabase Storage (bucket: "tenant-assets")
    const { error: uploadError } = await supabase.storage
      .from("tenant-assets")
      .upload(storagePath, buffer, {
        contentType: `image/${ext === "svg" ? "svg+xml" : ext}`,
        upsert: true,
      })

    if (uploadError) throw new Error(uploadError.message)

    // Get public URL
    const {
      data: { publicUrl },
    } = supabase.storage.from("tenant-assets").getPublicUrl(storagePath)

    // Update the tenants row
    const { error: updateError } = await supabase
      .from("tenants")
      .update({ logo_url: publicUrl })
      .eq("id", tenantId)

    if (updateError) throw new Error(updateError.message)

    revalidatePath("/dashboard/settings/white-label")

    return { success: true, data: { logoUrl: publicUrl } }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}

// ------------------------------------------------------------------
// Remove logo (set logo_url to null)
// ------------------------------------------------------------------

export async function removeLogo(): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId()
    const supabase = getAdminClient()

    const { error } = await supabase
      .from("tenants")
      .update({ logo_url: null })
      .eq("id", tenantId)

    if (error) throw new Error(error.message)

    revalidatePath("/dashboard/settings/white-label")

    return { success: true }
  } catch (err) {
    return { success: false, error: (err as Error).message }
  }
}