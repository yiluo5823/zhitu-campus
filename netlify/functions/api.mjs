import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";

const key = "community-state";
const store = () => getStore({ name: "zhitu-data", consistency: "strong" });
const empty = () => ({ cases: [], clues: [], profiles: {}, conversations: [] });
const read = async () => ({ ...empty(), ...((await store().get(key, { type: "json", consistency: "strong" })) || {}) });
const write = (state) => store().setJSON(key, state);
const json = (body, status = 200) => Response.json(body, { status });
const clean = (value, limit) => String(value || "").trim().replace(/[<>]/g, "").slice(0, limit);
const seed = [
  { id: 1, s: "社科 / 毕业论文", t: "导师说我的选题太大，但我已经改了五次。", d: "数字媒介如何影响大学生睡眠？我需要一条可以落地的研究路径。", c: 18, status: "published", authorName: "知途编辑部" },
  { id: 2, s: "工学 / 项目协作", t: "组员说不会 Python，但答辩只剩三天。", d: "我需要的是救火脚本，还是一个真正可展示的简化方案？", c: 9, status: "published", authorName: "知途编辑部" },
  { id: 3, s: "文学 / 文献阅读", t: "读了二十篇论文，感觉自己只会复制粘贴。", d: "怎样从阅读量走到可以写进综述的观点？", c: 23, status: "published", authorName: "知途编辑部" }
];
const reviewer = (user) => Boolean(user?.roles?.some((role) => ["admin", "moderator"].includes(role)));
const pub = (profile) => profile && ({ id: profile.id, name: profile.name, avatar: profile.avatar });
const profile = (state, user) => {
  if (!user) return null;
  const old = state.profiles[user.id] || {};
  const value = { id: user.id, email: user.email, name: clean(user.user_metadata?.full_name || old.name || user.email?.split("@")[0] || "同学", 32), avatar: old.avatar || "", roles: user.roles || [], joinedAt: old.joinedAt || new Date().toISOString() };
  state.profiles[user.id] = value; return value;
};
const needUser = (user) => user ? null : json({ error: "请先登录，再进行这个操作。" }, 401);

export default async (request) => {
  const user = await getUser().catch(() => null);
  const state = await read(); const me = profile(state, user);
  if (user) await write(state);
  if (request.method === "GET") {
    const published = state.cases.filter((x) => x.status === "published");
    const mine = user ? state.cases.filter((x) => x.authorId === user.id && x.status !== "published") : [];
    const conversations = user ? state.conversations.filter((x) => x.members.includes(user.id)).map((x) => ({ ...x, membersInfo: x.members.map((id) => pub(state.profiles[id])).filter(Boolean) })) : [];
    return json({ cases: [...seed, ...published, ...mine], clues: state.clues.filter((x) => x.status === "published"), me, conversations, reviewer: reviewer(user) });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({})); const unauth = needUser(user); if (unauth) return unauth;
  if (body.action === "createCase") {
    const title = clean(body.title, 90), detail = clean(body.detail, 600), subject = clean(body.subject, 40) || "新投稿 / 等待核验";
    if (title.length < 6 || detail.length < 12) return json({ error: "请补全具体卡点与需要的帮助。" }, 400);
    const item = { id: Date.now(), s: subject, t: title, d: detail, c: 0, authorId: user.id, authorName: me.name, status: "pending", createdAt: new Date().toISOString() };
    state.cases.unshift(item); await write(state); return json({ item }, 201);
  }
  if (body.action === "createClue") {
    const title = clean(body.title, 90), detail = clean(body.detail, 500);
    if (title.length < 4 || detail.length < 8) return json({ error: "线索需要包含具体建议或依据。" }, 400);
    const item = { id: Date.now(), caseId: Number(body.caseId), title, detail, authorId: user.id, authorName: me.name, status: "pending", createdAt: new Date().toISOString() };
    state.clues.unshift(item); await write(state); return json({ item }, 201);
  }
  if (body.action === "myData") return json({ me, cases: state.cases.filter((x) => x.authorId === user.id), clues: state.clues.filter((x) => x.authorId === user.id), conversations: state.conversations.filter((x) => x.members.includes(user.id)) });
  if (body.action === "reviewQueue") { if (!reviewer(user)) return json({ error: "需要编辑或管理员角色。" }, 403); return json({ cases: state.cases.filter((x) => x.status === "pending"), clues: state.clues.filter((x) => x.status === "pending") }); }
  if (body.action === "moderate") {
    if (!reviewer(user)) return json({ error: "需要编辑或管理员角色。" }, 403);
    const target = body.type === "clue" ? state.clues : state.cases; const item = target.find((x) => x.id === Number(body.id));
    if (!item) return json({ error: "未找到内容。" }, 404);
    item.status = body.status === "published" ? "published" : "rejected"; item.reviewedBy = me.name; item.reviewedAt = new Date().toISOString(); await write(state); return json({ item });
  }
  if (body.action === "startConversation") {
    const recipientId = clean(body.recipientId, 100); if (!recipientId || recipientId === user.id) return json({ error: "请选择一位可协作的同学。" }, 400);
    if (!state.profiles[recipientId]) return json({ error: "这位同学暂时无法接收私信。" }, 404);
    let thread = state.conversations.find((x) => x.caseId === Number(body.caseId) && x.members.includes(user.id) && x.members.includes(recipientId));
    if (!thread) { thread = { id: crypto.randomUUID(), caseId: Number(body.caseId) || null, members: [user.id, recipientId], messages: [], createdAt: new Date().toISOString() }; state.conversations.unshift(thread); await write(state); }
    return json({ thread: { ...thread, membersInfo: thread.members.map((id) => pub(state.profiles[id])) } });
  }
  if (body.action === "sendMessage") {
    const thread = state.conversations.find((x) => x.id === clean(body.threadId, 100)), text = clean(body.text, 1000);
    if (!thread || !thread.members.includes(user.id)) return json({ error: "没有这个协作空间的权限。" }, 403); if (!text) return json({ error: "消息不能为空。" }, 400);
    const message = { id: crypto.randomUUID(), authorId: user.id, authorName: me.name, text, createdAt: new Date().toISOString() }; thread.messages.push(message); thread.updatedAt = message.createdAt; await write(state); return json({ thread });
  }
  return json({ error: "未知操作" }, 400);
};
