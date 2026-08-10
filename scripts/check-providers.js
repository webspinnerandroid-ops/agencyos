const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase
    .from("ai_providers")
    .select("id, name, type")
    .order("type");

  if (error) {
    console.error("Query error:", error);
    process.exit(1);
  }

  console.log("Total providers:", data.length, "\n");

  const byType = {};
  for (const p of data) {
    if (!byType[p.type]) byType[p.type] = [];
    byType[p.type].push(p.name);
  }

  for (const [type, names] of Object.entries(byType)) {
    console.log(type + " (" + names.length + "):");
    for (const name of names) {
      console.log("  - " + name);
    }
    console.log("");
  }
}

main().catch(console.error);