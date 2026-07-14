import { getStore } from "@netlify/blobs";

const json = (data, status = 200) => Response.json(data, { status });
const store = () => getStore({ name: "zhitu-data", consistency: "strong" });
const key = "community-state";
const read = async () => (await store().get(key, { type: "json", consistency: "strong" })) || { cases: [], clues: [] };
const write = async (state) => store().setJSON(key, state);
const clean = (value, limit) => String(value || "").trim().replace(/[<>]/g, "").slice(0, limit);
const seed = [
  { id: 1, s: "社科 / 毕业论文", t: "导师说我的选题太大，但我已经改了五次。", d: "数字媒介如何影响大学生睡眠？我需要一条可以落地的研究路径。", c: 18, status: "published" },
  { id: 2, s: "工学 / 项目协作", t: "组员说不会 Python，但答辩只剩三天。", d: "我需要的是救火脚本，还是一个真正可展示的简化方案？", c: 9, status: "published" },
  { id: 3, s: "文学 / 文献阅读", t: "读了二十篇论文，感觉自己只会复制粘贴。", d: "怎样从阅读量走到可以写进综述的观点？", c: 23, status: "published" }
];

export default async (request) => {
  const url = new URL(request.url);
  const clientId = clean(url.searchParams.get("clientId"), 80);
  const state = await read();
  if (request.method === "GET") {
    const published = state.cases.filter((item) => item.status === "published");
    const mine = clientId ? state.cases.filter((item) => item.clientId === clientId && item.status !== "published") : [];
    return json({ cases: [...seed, ...published, ...mine], clues: state.clues.filter((item) => item.status === "published") });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  if (body.action === "createCase") {
    const title = clean(body.title, 90), detail = clean(body.detail, 600);
    if (title.length < 6 || detail.length < 12) return json({ error: "请补全具体卡点与需要的帮助。" }, 400);
    const item = { id: Date.now(), s: "新投稿 / 等待核验", t: title, d: detail, c: 0, clientId: clean(body.clientId, 80), status: "pending", createdAt: new Date().toISOString() };
    state.cases.unshift(item); await write(state); return json({ item }, 201);
  }
  if (body.action === "createClue") {
    const title = clean(body.title, 90), detail = clean(body.detail, 500);
    if (title.length < 4 || detail.length < 8) return json({ error: "线索需要包含具体建议或依据。" }, 400);
    const item = { id: Date.now(), caseId: Number(body.caseId), title, detail, status: "pending", createdAt: new Date().toISOString() };
    state.clues.unshift(item); await write(state); return json({ item }, 201);
  }
  if (body.action === "moderate") {
    if (!process.env.MODERATION_KEY || request.headers.get("x-moderation-key") !== process.env.MODERATION_KEY) return json({ error: "无审核权限" }, 401);
    const target = body.type === "clue" ? state.clues : state.cases;
    const item = target.find((entry) => entry.id === Number(body.id));
    if (!item) return json({ error: "未找到内容" }, 404);
    item.status = body.status === "published" ? "published" : "rejected"; await write(state); return json({ item });
  }
  return json({ error: "未知操作" }, 400);
};
