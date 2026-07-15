export async function onRequestGet({ env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.json({ error: "Supabase 环境变量尚未配置。" }, { status: 503 });
  }
  return Response.json({ supabaseUrl: env.SUPABASE_URL, supabaseAnonKey: env.SUPABASE_ANON_KEY }, { headers: { "cache-control": "public, max-age=300" } });
}
