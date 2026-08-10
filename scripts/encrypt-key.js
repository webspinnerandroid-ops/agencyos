// Encrypt Google API key and update tenant_api_keys in Supabase
const CryptoJS = require("crypto-js");
const { createClient } = require("@supabase/supabase-js");

const ENCRYPTION_KEY = "<REDACTED - see git-ignored .env.local>";
const NEW_API_KEY = "<REDACTED - see git-ignored .env.local>";
const TENANT_ID = "0d564113-5b76-42c7-8e81-310ac469fd07";
const PROVIDER_ID = "00000000-0000-0000-0000-000000000107"; // Google Imagen

async function main() {
  // 1. Encrypt the new key
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(NEW_API_KEY, CryptoJS.enc.Hex.parse(ENCRYPTION_KEY), {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const ivHex = iv.toString(CryptoJS.enc.Hex);
  const cipherHex = encrypted.ciphertext.toString(CryptoJS.enc.Hex);
  const fullHex = ivHex + cipherHex;

  // Store as JSON Buffer format (matching what byteaToHex expects)
  const jsonBuffer = JSON.stringify({
    type: "Buffer",
    data: Array.from(Buffer.from(fullHex, "hex")),
  });

  console.log("Encrypted hex length:", fullHex.length);
  console.log("JSON buffer length:", jsonBuffer.length);

  // 2. Update Supabase
  const supabase = createClient(
    "https://axqcmiisztnqcntprhdy.supabase.co",
    "<REDACTED - see git-ignored .env.local>",
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Delete any old keys for this provider
  const { error: delErr } = await supabase
    .from("tenant_api_keys")
    .delete()
    .eq("tenant_id", TENANT_ID)
    .eq("provider_id", PROVIDER_ID);

  if (delErr) console.log("Delete warning:", delErr.message);

  // Insert new key
  const { data, error } = await supabase
    .from("tenant_api_keys")
    .insert({
      tenant_id: TENANT_ID,
      provider_id: PROVIDER_ID,
      encrypted_key: jsonBuffer,
      is_active: true,
    })
    .select("id")
    .single();

  if (error) {
    console.error("INSERT ERROR:", error.message);
    process.exit(1);
  }

  console.log("SUCCESS — new key stored with id:", data.id);
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(1);
});