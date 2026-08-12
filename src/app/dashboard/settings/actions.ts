"use server";

import { createServiceClient } from "@/lib/supabase/server";
import { getRole } from "@/lib/auth";

export interface SiteSettings {
  hero_mode: "slideshow" | "video";
  hero_video_url: string;
}

async function requireSuperAdmin() {
  const role = await getRole();
  if (role !== "super_admin") {
    throw new Error("Forbidden: super_admin access required");
  }
}

export async function getSiteSettings(): Promise<{
  success: boolean;
  data?: SiteSettings;
  error?: string;
}> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const { data, error } = await supabase
      .from("site_settings")
      .select("hero_mode, hero_video_url")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      success: true,
      data: {
        hero_mode: data?.hero_mode === "video" ? "video" : "slideshow",
        hero_video_url: data?.hero_video_url ?? "",
      },
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function updateSiteSettings(
  heroMode: "slideshow" | "video",
  heroVideoUrl: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin();
    const supabase = await createServiceClient();
    const url = heroVideoUrl.trim();
    const { error } = await supabase
      .from("site_settings")
      .update({
        hero_mode: heroMode,
        hero_video_url: heroMode === "video" ? url : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
