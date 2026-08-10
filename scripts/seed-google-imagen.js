// Seed Google Imagen provider and model into Supabase
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

async function main() {
  const c = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const providerId = "00000000-0000-0000-0000-000000000107";

  // Upsert Google Imagen provider
  const { data: providerData, error: providerErr } = await c
    .from("ai_providers")
    .upsert(
      {
        id: providerId,
        name: "Google Imagen",
        base_url: "https://generativelanguage.googleapis.com/v1beta",
        type: "image",
      },
      { onConflict: "id" }
    );

  if (providerErr) {
    console.error("Provider upsert failed:", providerErr);
  } else {
    console.log("Provider upserted:", JSON.stringify(providerData ?? "OK"));
  }

  // Upsert Google Imagen model
  const { data: modelData, error: modelErr } = await c
    .from("ai_models")
    .upsert(
      {
        id: "17000000-0000-0000-0000-000000000001",
        provider_id: providerId,
        model_identifier: "imagen-3.0-generate-001",
        supported_tasks: ["image_generation"],
      },
      { onConflict: "id" }
    );

  if (modelErr) {
    console.error("Model upsert failed:", modelErr);
    process.exit(1);
  } else {
    console.log("Model upserted:", JSON.stringify(modelData ?? "OK"));
  }

  console.log("DONE — Google Imagen seeded successfully");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});