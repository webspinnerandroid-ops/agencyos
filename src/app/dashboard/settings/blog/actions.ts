"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { getTenantId } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface BlogPlatform {
  id: string;
  tenant_id: string;
  platform_type: string;
  site_url: string;
  site_name: string;
  created_at: string;
}

export interface ActionResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

const SUPPORTED_PLATFORMS = [
  {
    id: "wordpress",
    name: "WordPress",
    icon: "📝",
    description: "Connect via REST API with Application Password",
    authMethod: "application_password",
    authFields: [
      { name: "username", label: "Username", type: "text" },
      { name: "applicationPassword", label: "Application Password", type: "password", hint: "Create in Users → Profile → Application Passwords" },
    ],
  },
  {
    id: "wordpress_jetpack",
    name: "WordPress.com / Jetpack",
    icon: "🚀",
    description: "Connect WordPress.com or Jetpack-enabled sites",
    authMethod: "oauth",
    authFields: [
      { name: "siteUrl", label: "Site URL", type: "text" },
    ],
  },
  {
    id: "joomla",
    name: "Joomla",
    icon: "🏗️",
    description: "Connect via Joomla API with API Key",
    authMethod: "api_key",
    authFields: [
      { name: "apiKey", label: "API Key", type: "password", hint: "Generate in Joomla Admin → Components → API Keys" },
    ],
  },
  {
    id: "drupal",
    name: "Drupal",
    icon: "💧",
    description: "Connect via REST API with Basic Auth",
    authMethod: "basic_auth",
    authFields: [
      { name: "username", label: "Username", type: "text" },
      { name: "password", label: "Password", type: "password" },
    ],
  },
  {
    id: "ghost",
    name: "Ghost",
    icon: "👻",
    description: "Connect via Admin API with Admin API Key",
    authMethod: "api_key",
    authFields: [
      { name: "adminApiKey", label: "Admin API Key", type: "password", hint: "Create in Ghost Admin → Integrations" },
    ],
  },
  {
    id: "webflow",
    name: "Webflow",
    icon: "🌊",
    description: "Connect via Webflow CMS API",
    authMethod: "api_key",
    authFields: [
      { name: "apiToken", label: "API Token", type: "password", hint: "Generate in Webflow Dashboard → Integrations" },
    ],
  },
] as const;

export type SupportedBlogPlatform = (typeof SUPPORTED_PLATFORMS)[number];

// ------------------------------------------------------------------
// Actions
// ------------------------------------------------------------------

export async function getSupportedBlogPlatforms() {
  return SUPPORTED_PLATFORMS;
}

export async function getBlogPlatforms(): Promise<ActionResponse<BlogPlatform[]>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { data, error } = await supabase
      .from("blog_platforms")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return { success: true, data: data as BlogPlatform[] };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function connectBlogPlatform(
  platformType: string,
  siteUrl: string,
  siteName: string,
  credentials: Record<string, string>
): Promise<ActionResponse<BlogPlatform>> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const encryptedCreds = encrypt(JSON.stringify(credentials));

    const { data, error } = await supabase
      .from("blog_platforms")
      .insert({
        tenant_id: tenantId,
        platform_type: platformType,
        site_url: siteUrl,
        site_name: siteName,
        encrypted_credentials: encryptedCreds,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/blog");
    return { success: true, data: data as BlogPlatform };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function removeBlogPlatform(platformId: string): Promise<ActionResponse> {
  try {
    const tenantId = await getTenantId();
    const supabase = await createServiceClient();

    const { error } = await supabase
      .from("blog_platforms")
      .delete()
      .eq("id", platformId)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);

    revalidatePath("/dashboard/settings/blog");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}