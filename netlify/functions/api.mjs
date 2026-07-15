import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";

const stateKey = "zhitu-paid-qa-v1";
const db = () => getStore({ name: "zhitu-data", consistency: "strong" });
const blank = () => ({ questions: [], answers: [], profiles: {}, unlocks: [], files: {} });
const read = async () => ({ ...blank(), ...((await db().get(stateKey, { type: "json", consistency: "strong" })) || {}) });
const save = (state) => db().setJSON(stateKey, state);
const out = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const clean = (value, length) => String(value || "").trim().replace(/[<>]/g, "").slice(0, length);
const canReview = (user) => Boolean(user?.roles?.some((role) => ["admin", "moderator"].includes(role)));
const seed = [
  { id: "seed-1", category: "社科 / 毕业论文", tier: "标准", bounty: 60, title: "如何把“短视频使用影响睡眠质量”缩成可检验的毕业论文选题？", detail: "我已有一批文献，但变量、样本和研究方法还没有确定。希望得到一条可执行的研究路径。", authorName: "匿名提问者", authorId: "seed", answerCount: 2, status: "open", createdAt: "2026-07-15T00:00:00.000Z", attachments: [] },
  { id: "seed-2", category: "工学 / 编程", tier: "加急", bounty: 120, title: "答辩前 72 小时，如何把 Python 数据清洗脚本收束为可展示方案？", detail: "数据表字段混乱，需要一条最小可行的清洗、可视化和展示路径。", authorName: "匿名提问者", authorId: "seed", answerCount: 1, status: "open", createdAt: "2026-07-14T00:00:00.000Z", attachments: [] }
];
const publicProfile = (profile) => profile && ({ id: profile.id, name: profile.name, education: profile.education || "未认证", verified: Boolean(profile.verified), answerWins: profile.answerWins || 0, questionCount: profile.questionCount || 0 });
const ensureProfile = (state, user) => {
  if (!user) return null;
  const previous = state.profiles[user.id] || {};
  const value = { id: user.id, email: user.email, name: clean(user.userMetadata?.full_name || user.user_metadata?.full_name || previous.name || user.email?.split("@")[0] || "同学", 32), education: previous.education || "未填写", verified: Boolean(previous.verified), credits: Number.isFinite(previous.credits) ? previous.credits : 500, questionCount: previous.questionCount || 0, answerCount: previous.answerCount || 0, answerWins: previous.answerWins || 0, roles: user.roles || [], joinedAt: previous.joinedAt || new Date().toISOString() };
  state.profiles[user.id] = value; return value;
};
const needed = (user) => user ? null : out({ error: "请先登录。" }, 401);
const quality = (full, attachments) => ({ completeness: Math.min(98, 48 + Math.floor(full.length / 18) + attachments.length * 8), accuracy: Math.min(96, 52 + Math.floor(full.length / 35) + attachments.length * 6) });
const ownsUnlock = (state, userId, answerId) => state.unlocks.some((item) => item.userId === userId && item.answerId === answerId);
const allowFile = (state, file, userId) => {
  if (!file) return false;
  if (file.visibility === "question") return true;
  const answer = state.answers.find((item) => item.id === file.answerId);
  return Boolean(answer && (answer.authorId === userId || answer.questionAuthorId === userId || ownsUnlock(state, userId, answer.id)));
};

export default async (request) => {
  const url = new URL(request.url); const user = await getUser().catch(() => null); const state = await read(); const me = ensureProfile(state, user);
  if (user) await save(state);
  if (request.method === "GET" && url.searchParams.get("file")) {
    if (!user) return out({ error: "请先登录后下载附件。" }, 401);
    const file = state.files[url.searchParams.get("file")]; if (!allowFile(state, file, user.id)) return out({ error: "请先解锁回答后查看该附件。" }, 403);
    const data = await db().get(file.key, { type: "arrayBuffer" }); if (!data) return out({ error: "附件不存在。" }, 404);
    return new Response(data, { headers: { "content-type": file.type || "application/octet-stream", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}` } });
  }
  if (request.method === "GET") {
    const questions = [...seed, ...state.questions.filter((item) => item.status === "open" || item.authorId === user?.id)];
    const visibleAnswers = state.answers.filter((item) => item.status === "published").map((item) => ({ ...item, full: user && (item.authorId === user.id || item.questionAuthorId === user.id || item.price === 0 || ownsUnlock(state, user.id, item.id)) ? item.full : "", unlocked: Boolean(user && (item.authorId === user.id || item.questionAuthorId === user.id || item.price === 0 || ownsUnlock(state, user.id, item.id))) }));
    return out({ questions, answers: visibleAnswers, me: me && publicProfile(me), credits: me?.credits || 0, reviewer: canReview(user) });
  }
  if (request.method !== "POST") return out({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({})); const noUser = needed(user); if (noUser) return noUser;
  if (body.action === "uploadFile") {
    const name = clean(body.name, 120), type = clean(body.type, 100), data = String(body.data || "");
    if (!name || !data.includes(",")) return out({ error: "请选择有效附件。" }, 400);
    const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0));
    if (bytes.byteLength > 4 * 1024 * 1024) return out({ error: "单个附件请控制在 4MB 以内。" }, 413);
    const id = crypto.randomUUID(); const key = `uploads/${id}`; await db().set(key, bytes, { metadata: { name, type, ownerId: user.id } });
    state.files[id] = { id, key, name, type, size: bytes.byteLength, ownerId: user.id, visibility: "draft" }; await save(state); return out({ file: { id, name, type, size: bytes.byteLength } }, 201);
  }
  if (body.action === "createQuestion") {
    const title = clean(body.title, 100), detail = clean(body.detail, 1600), category = clean(body.category, 40) || "综合 / 学术问题"; const bounty = Number(body.bounty);
    if (title.length < 8 || detail.length < 20) return out({ error: "请写清问题背景、已有尝试和希望得到的帮助。" }, 400);
    if (![30, 60, 120, 300].includes(bounty)) return out({ error: "请选择一个有效的悬赏档位。" }, 400);
    if (me.credits < bounty) return out({ error: "知点余额不足，暂时无法发布该档位。" }, 400);
    const attachments = (body.attachments || []).map((item) => state.files[item.id]).filter((file) => file && file.ownerId === user.id).map((file) => { file.visibility = "question"; return { id: file.id, name: file.name, type: file.type, size: file.size }; });
    const question = { id: crypto.randomUUID(), title, detail, category, tier: ({ 30: "轻量", 60: "标准", 120: "加急", 300: "深度" })[bounty], bounty, authorId: user.id, authorName: me.name, answerCount: 0, attachments, status: "open", createdAt: new Date().toISOString() };
    me.credits -= bounty; me.questionCount += 1; state.questions.unshift(question); await save(state); return out({ question }, 201);
  }
  if (body.action === "createAnswer") {
    const question = [...seed, ...state.questions].find((item) => item.id === String(body.questionId)); const preview = clean(body.preview, 260), full = clean(body.full, 5000), price = Number(body.price);
    if (!question || question.status !== "open") return out({ error: "问题不存在或已关闭。" }, 404); if (question.authorId === user.id) return out({ error: "不能回答自己发布的问题。" }, 400);
    if (preview.length < 12 || full.length < 80) return out({ error: "请提供足够具体的摘要与完整回答。" }, 400); if (![0, 10, 30, 60, 120].includes(price)) return out({ error: "请选择回答解锁价。" }, 400);
    const attachments = (body.attachments || []).map((item) => state.files[item.id]).filter((file) => file && file.ownerId === user.id).map((file) => { file.visibility = "answer"; return { id: file.id, name: file.name, type: file.type, size: file.size }; });
    const scores = quality(full, attachments); const answer = { id: crypto.randomUUID(), questionId: question.id, questionAuthorId: question.authorId, authorId: user.id, authorName: me.name, author: publicProfile(me), preview, full, price, attachments, ...scores, status: "published", createdAt: new Date().toISOString() };
    state.answers.unshift(answer); if (!question.id.startsWith("seed")) question.answerCount = (question.answerCount || 0) + 1; me.answerCount += 1; await save(state); return out({ answer }, 201);
  }
  if (body.action === "unlockAnswer") {
    const answer = state.answers.find((item) => item.id === String(body.answerId)); if (!answer) return out({ error: "回答不存在。" }, 404); if (answer.questionAuthorId !== user.id && !ownsUnlock(state, user.id, answer.id)) return out({ error: "只有提问者可以解锁此付费回答。" }, 403);
    if (!ownsUnlock(state, user.id, answer.id) && answer.price > 0) { if (me.credits < answer.price) return out({ error: "知点余额不足，无法完成解锁。" }, 400); me.credits -= answer.price; const author = state.profiles[answer.authorId]; if (author) { author.credits += answer.price; author.answerWins += 1; } state.unlocks.push({ userId: user.id, answerId: answer.id, paid: answer.price, createdAt: new Date().toISOString() }); await save(state); }
    return out({ answer: { ...answer, unlocked: true }, credits: me.credits });
  }
  if (body.action === "updateProfile") {
    me.education = clean(body.education, 140) || me.education; await save(state); return out({ me: publicProfile(me) });
  }
  if (body.action === "myData") return out({ me: publicProfile(me), credits: me.credits, questions: state.questions.filter((item) => item.authorId === user.id), answers: state.answers.filter((item) => item.authorId === user.id), unlocks: state.unlocks.filter((item) => item.userId === user.id) });
  if (body.action === "reviewProfile") { if (!canReview(user)) return out({ error: "需要管理员权限。" }, 403); const target = state.profiles[clean(body.userId, 100)]; if (!target) return out({ error: "用户不存在。" }, 404); target.verified = Boolean(body.verified); await save(state); return out({ profile: publicProfile(target) }); }
  return out({ error: "未知操作" }, 400);
};
