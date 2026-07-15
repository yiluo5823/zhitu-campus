import { getStore } from "@netlify/blobs";
import { getUser } from "@netlify/identity";
import OpenAI from "openai";

const stateKey = "zhitu-paid-qa-v1";
const db = () => getStore({ name: "zhitu-data", consistency: "strong" });
const blank = () => ({ questions: [], answers: [], profiles: {}, unlocks: [], files: {}, posts: [], forumReplies: [], offers: [], assets: [], assetUnlocks: [], communityFund: 0 });
const read = async () => ({ ...blank(), ...((await db().get(stateKey, { type: "json", consistency: "strong" })) || {}) });
const save = (state) => db().setJSON(stateKey, state);
const out = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const clean = (value, length) => String(value || "").trim().replace(/[<>]/g, "").slice(0, length);
const safeModelBaseURL = (value) => {
  try {
    const url = new URL(value); const host = url.hostname.toLowerCase();
    const privateHost = host === "localhost" || host === "::1" || host === "0.0.0.0" || host.endsWith(".local") || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "169.254.169.254";
    return url.protocol === "https:" && !privateHost ? url.toString().replace(/\/$/, "") : "";
  } catch { return ""; }
};
const canReview = (user) => Boolean(user?.roles?.some((role) => ["admin", "moderator"].includes(role)));
const seed = [
  { id: "seed-1", category: "社科 / 毕业论文", tier: "标准", bounty: 60, title: "如何把“短视频使用影响睡眠质量”缩成可检验的毕业论文选题？", detail: "我已有一批文献，但变量、样本和研究方法还没有确定。希望得到一条可执行的研究路径。", authorName: "匿名提问者", authorId: "seed", answerCount: 2, status: "open", createdAt: "2026-07-15T00:00:00.000Z", attachments: [] },
  { id: "seed-2", category: "工学 / 编程", tier: "加急", bounty: 120, title: "答辩前 72 小时，如何把 Python 数据清洗脚本收束为可展示方案？", detail: "数据表字段混乱，需要一条最小可行的清洗、可视化和展示路径。", authorName: "匿名提问者", authorId: "seed", answerCount: 1, status: "open", createdAt: "2026-07-14T00:00:00.000Z", attachments: [] }
];
const seedPosts = [
  { id: "news-1", category: "行业新闻", title: "高校正在重新讨论：生成式 AI 如何进入课程与论文规范", summary: "从一刀切禁用转向声明使用范围、过程留痕与人工核验，新的学术规范正在形成。", content: "越来越多高校把重点从“是否使用 AI”转向“如何透明、可核验地使用 AI”。对学生而言，关键是保留检索、判断、修改和引用过程，并明确声明工具参与范围。", authorName: "知途编辑部", official: true, replyCount: 18, createdAt: "2026-07-15T01:00:00.000Z", status: "published" },
  { id: "news-2", category: "科研工具", title: "文献检索开始从“找相似论文”转向“找能支撑当前判断的证据”", summary: "新一代研究工具更强调问题拆解、段落级证据与引用链，而不是给出一长串搜索结果。", content: "真正有用的检索，不是把关键词重复输入数据库，而是先判断问题需要定义、方法、数据还是反例，再针对证据类型展开。知途知识库也采用这一逻辑。", authorName: "知途编辑部", official: true, replyCount: 31, createdAt: "2026-07-14T03:00:00.000Z", status: "published" },
  { id: "news-3", category: "校园讨论", title: "付费答疑的价值边界：买的是答案，还是更快抵达答案的路径？", summary: "高质量付费回答应当包含判断依据、可复用流程和风险边界，而不只是一个结论。", content: "当回答可以被验证、复用并帮助提问者掌握方法时，付费才具有长期价值。平台因此同时展示完整度、准确度、附件和回答者认证信息。", authorName: "知途编辑部", official: true, replyCount: 42, createdAt: "2026-07-13T04:00:00.000Z", status: "published" }
];
const publicProfile = (profile) => profile && ({ id: profile.id, name: profile.name, education: profile.education || "未认证", verified: Boolean(profile.verified), answerWins: profile.answerWins || 0, questionCount: profile.questionCount || 0 });
const ensureProfile = (state, user) => {
  if (!user) return null;
  const previous = state.profiles[user.id] || {};
  const value = { id: user.id, email: user.email, name: clean(user.userMetadata?.full_name || user.user_metadata?.full_name || previous.name || user.email?.split("@")[0] || "同学", 32), education: previous.education || "未填写", verified: Boolean(previous.verified), credits: Number.isFinite(previous.credits) ? previous.credits : 500, questionCount: previous.questionCount || 0, answerCount: previous.answerCount || 0, answerWins: previous.answerWins || 0, royaltyEarned: previous.royaltyEarned || 0, roles: user.roles || [], joinedAt: previous.joinedAt || new Date().toISOString() };
  state.profiles[user.id] = value; return value;
};
const needed = (user) => user ? null : out({ error: "请先登录。" }, 401);
const quality = (full, attachments) => ({ completeness: Math.min(98, 48 + Math.floor(full.length / 18) + attachments.length * 8), accuracy: Math.min(96, 52 + Math.floor(full.length / 35) + attachments.length * 6) });
const ownsUnlock = (state, userId, answerId) => state.unlocks.some((item) => item.userId === userId && item.answerId === answerId);
const ownsAsset = (state, userId, assetId) => state.assetUnlocks.some((item) => item.userId === userId && item.assetId === assetId);
const allowFile = (state, file, userId) => {
  if (!file) return false;
  if (file.visibility === "question") return true;
  const answer = state.answers.find((item) => item.id === file.answerId);
  return Boolean(answer && (answer.authorId === userId || answer.questionAuthorId === userId || ownsUnlock(state, userId, answer.id)));
};
const localKnowledgeAnswer = (query) => {
  const text = clean(query, 1200); const isCode = /代码|python|程序|报错|数据/.test(text), isPaper = /论文|选题|文献|综述|研究/.test(text), isDesign = /设计|视觉|产品|作品/.test(text);
  const focus = isCode ? "先复现问题并固定唯一期望输出，再检查输入、核心处理和结果验证。" : isPaper ? "先把研究对象、核心变量、作用机制和样本边界写成一句可检验问题。" : isDesign ? "先明确使用场景与评价标准，再把元素转译为可复用的设计规则。" : "先把当前困难改写成一个有输入、约束和可验证输出的任务。";
  return `针对“${text.slice(0, 80)}”，建议从以下路径推进：\n\n1. 问题判断\n${focus}\n\n2. 立即行动\n列出你已经拥有的资料、尚缺的证据和最终要交付的结果；每项只保留最关键的一条。\n\n3. 核验标准\n检查结论是否能被来源、数据或可复现步骤支持。不能核验的内容暂时只作为假设。\n\n4. 下一步\n先完成一个最小版本，再根据失败点补充资料。如果仍无法推进，可把具体卡点转成悬赏问题。`;
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
    const visibleAnswers = state.answers.filter((item) => item.status === "published").map((item) => ({ ...item, full: item.price === 0 || (user && (item.authorId === user.id || ownsUnlock(state, user.id, item.id))) ? item.full : "", unlocked: Boolean(item.price === 0 || (user && (item.authorId === user.id || ownsUnlock(state, user.id, item.id)))), offer: user ? state.offers.filter((offer) => offer.answerId === item.id && (offer.buyerId === user.id || offer.sellerId === user.id)).at(-1) || null : null }));
    const posts = [...seedPosts, ...state.posts.filter((item) => item.status === "published" || item.authorId === user?.id)];
    const forumReplies = state.forumReplies.filter((item) => item.status === "published" || item.authorId === user?.id);
    const assets = state.assets.filter((item) => item.status === "published").map((item) => ({ ...item, content: item.price === 0 || (user && (item.authorId === user.id || ownsAsset(state, user.id, item.id))) ? item.content : "", unlocked: Boolean(item.price === 0 || (user && (item.authorId === user.id || ownsAsset(state, user.id, item.id)))) }));
    return out({ questions, answers: visibleAnswers, posts, forumReplies, assets, me: me && { ...publicProfile(me), royaltyEarned: me.royaltyEarned }, credits: me?.credits || 0, reviewer: canReview(user) });
  }
  if (request.method !== "POST") return out({ error: "Method not allowed" }, 405);
  const body = await request.json().catch(() => ({}));
  if (body.action === "estimateQuestion") {
    const detail = clean(body.detail, 1800), category = clean(body.category, 60), attachments = Math.min(10, Number(body.attachments) || 0), fromKnowledge = Boolean(body.fromKnowledge); let recommended = 25;
    const reasons = []; if (detail.length > 300) { recommended += 25; reasons.push("背景信息较完整"); } if (detail.length > 800) { recommended += 35; reasons.push("任务说明较复杂"); } if (attachments) { recommended += attachments * 12; reasons.push(`${attachments} 个附件需要阅读`); } if (/加急|今天|明天|答辩|截止|小时/.test(detail)) { recommended += 60; reasons.push("存在时间压力"); } if (/代码|数据|统计|实验|建模/.test(detail + category)) { recommended += 35; reasons.push("需要技术验证"); } if (fromKnowledge) { recommended += 20; reasons.push("已完成知识库预诊断"); } recommended = Math.min(1000, Math.max(10, Math.round(recommended / 5) * 5));
    return out({ estimate: { min: Math.max(10, recommended - Math.max(15, Math.round(recommended * .25))), recommended, max: Math.min(1000, recommended + Math.max(20, Math.round(recommended * .4))), reasons: reasons.length ? reasons : ["常规问题复杂度"] } });
  }
  if (body.action === "askKnowledge") {
    const query = clean(body.query, 1400); if (query.length < 4) return out({ error: "请描述一个更具体的问题。" }, 400);
    if (body.forceLocal) return out({ answer: localKnowledgeAnswer(query), responseId: null, mode: "local" });
    try {
      const history = Array.isArray(body.history) ? body.history.slice(-8).map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: clean(item.text, 1800) })).filter((item) => item.content) : [];
      const openai = new OpenAI(); const requestBody = { model: process.env.OPENAI_MODEL || "gpt-5-mini", instructions: "你是知途问题解决助手，服务高校学生。请结合对话上下文，针对用户的具体问题给出不同且可执行的中文回答。先判断问题类型和缺失信息，再给出分步骤方案、可核验标准和下一步。不得虚构文献、网址、数据或权威结论；需要来源时明确建议用户核验。回答控制在900字内。", input: [...history, { role: "user", content: query }], max_output_tokens: 1200 };
      const response = await openai.responses.create(requestBody); return out({ answer: response.output_text, responseId: response.id, mode: "ai" });
    } catch (error) { console.error("AI Gateway fallback", error?.message); return out({ answer: localKnowledgeAnswer(query), responseId: null, mode: "local" }); }
  }
  if (body.action === "askKnowledgeByok") {
    const query = clean(body.query, 1400), apiKey = clean(body.apiKey, 500), baseURL = safeModelBaseURL(clean(body.baseURL, 500)), model = clean(body.model, 160); if (query.length < 4 || !apiKey || !baseURL || !model) return out({ error: "请填写有效的 HTTPS 模型地址、模型名称和 API Key。" }, 400);
    try { const client = new OpenAI({ apiKey, baseURL }); const history = Array.isArray(body.history) ? body.history.slice(-8).map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", content: clean(item.text, 1800) })) : []; const result = await client.chat.completions.create({ model, messages: [{ role: "system", content: "你是知途问题解决助手。结合上下文给出可执行步骤、核验标准和下一步，不虚构来源，900字内。" }, ...history, { role: "user", content: query }], max_tokens: 1200 }); return out({ answer: result.choices?.[0]?.message?.content || "模型没有返回文本。", mode: "byok" }); } catch (error) { return out({ error: `模型接口调用失败：${clean(error?.message, 240)}` }, 502); }
  }
  const noUser = needed(user); if (noUser) return noUser;
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
    if (!Number.isInteger(bounty) || bounty < 10 || bounty > 1000) return out({ error: "悬赏金额应在 10–1000 知点之间。" }, 400);
    if (me.credits < bounty) return out({ error: "知点余额不足，暂时无法发布该档位。" }, 400);
    const attachments = (body.attachments || []).map((item) => state.files[item.id]).filter((file) => file && file.ownerId === user.id).map((file) => { file.visibility = "question"; return { id: file.id, name: file.name, type: file.type, size: file.size }; });
    const tier = bounty < 50 ? "轻量" : bounty < 120 ? "标准" : bounty < 300 ? "加急" : "深度"; const question = { id: crypto.randomUUID(), title, detail, category, tier, bounty, authorId: user.id, authorName: me.name, answerCount: 0, attachments, origin: body.origin === "knowledge" ? "knowledge" : "direct", knowledgeContext: clean(body.knowledgeContext, 2600), pricingEstimate: body.pricingEstimate || null, status: "open", createdAt: new Date().toISOString() };
    me.credits -= bounty; me.questionCount += 1; state.questions.unshift(question); await save(state); return out({ question }, 201);
  }
  if (body.action === "createForumPost") {
    const title = clean(body.title, 100), content = clean(body.content, 1800), category = clean(body.category, 30) || "校园讨论";
    if (title.length < 8 || content.length < 30) return out({ error: "请把话题与观点写得更具体一些。" }, 400);
    const post = { id: crypto.randomUUID(), title, summary: content.slice(0, 120), content, category, authorId: user.id, authorName: me.name, official: false, replyCount: 0, status: canReview(user) ? "published" : "pending", createdAt: new Date().toISOString() };
    state.posts.unshift(post); await save(state); return out({ post }, 201);
  }
  if (body.action === "createForumReply") {
    const post = [...seedPosts, ...state.posts].find((item) => item.id === String(body.postId)), content = clean(body.content, 1000);
    if (!post) return out({ error: "话题不存在。" }, 404); if (content.length < 8) return out({ error: "回复需要包含一个完整观点。" }, 400);
    const reply = { id: crypto.randomUUID(), postId: post.id, content, authorId: user.id, authorName: me.name, status: canReview(user) ? "published" : "pending", createdAt: new Date().toISOString() };
    state.forumReplies.push(reply); if (!post.id.startsWith("news-")) post.replyCount = (post.replyCount || 0) + 1; await save(state); return out({ reply }, 201);
  }
  if (body.action === "createAnswer") {
    const question = [...seed, ...state.questions].find((item) => item.id === String(body.questionId)); const preview = clean(body.preview, 260), full = clean(body.full, 5000), price = Number(body.price);
    if (!question || question.status !== "open") return out({ error: "问题不存在或已关闭。" }, 404); if (question.authorId === user.id) return out({ error: "不能回答自己发布的问题。" }, 400);
    if (preview.length < 12 || full.length < 80) return out({ error: "请提供足够具体的摘要与完整回答。" }, 400); if (!Number.isInteger(price) || price < 0 || price > 500) return out({ error: "回答解锁价应在 0–500 知点之间。" }, 400);
    const attachments = (body.attachments || []).map((item) => state.files[item.id]).filter((file) => file && file.ownerId === user.id).map((file) => { file.visibility = "answer"; return { id: file.id, name: file.name, type: file.type, size: file.size }; });
    const baseScores = quality(full, attachments), evidenceType = clean(body.evidenceType, 40) || "经验判断", sourceNote = clean(body.sourceNote, 1000); const evidence = { type: evidenceType, sourceNote, sourceQuality: Math.min(95, 40 + (sourceNote.length > 80 ? 25 : 0) + (attachments.length ? 20 : 0) + (/文献|数据|代码|实验/.test(evidenceType) ? 10 : 0)), reproducibility: Math.min(96, 45 + (full.length > 300 ? 20 : 0) + (attachments.length ? 15 : 0) + (/步骤|首先|然后|最后|1\.|2\./.test(full) ? 16 : 0)) }; const answer = { id: crypto.randomUUID(), questionId: question.id, questionAuthorId: question.authorId, authorId: user.id, authorName: me.name, author: publicProfile(me), preview, full, price, attachments, completeness: baseScores.completeness, accuracy: null, evidence, accepted: false, status: "published", createdAt: new Date().toISOString() };
    state.answers.unshift(answer); if (!question.id.startsWith("seed")) question.answerCount = (question.answerCount || 0) + 1; me.answerCount += 1; await save(state); return out({ answer }, 201);
  }
  if (body.action === "unlockAnswer") {
    const answer = state.answers.find((item) => item.id === String(body.answerId)); if (!answer) return out({ error: "回答不存在。" }, 404); if (answer.questionAuthorId !== user.id && !ownsUnlock(state, user.id, answer.id)) return out({ error: "只有提问者可以解锁此付费回答。" }, 403);
    if (!ownsUnlock(state, user.id, answer.id) && answer.price > 0) { if (me.credits < answer.price) return out({ error: "知点余额不足，无法完成解锁。" }, 400); me.credits -= answer.price; const author = state.profiles[answer.authorId]; if (author) { author.credits += answer.price; author.answerWins += 1; } state.unlocks.push({ userId: user.id, answerId: answer.id, paid: answer.price, createdAt: new Date().toISOString() }); await save(state); }
    return out({ answer: { ...answer, unlocked: true }, credits: me.credits });
  }
  if (body.action === "proposeOffer") {
    const answer = state.answers.find((item) => item.id === String(body.answerId)), amount = Number(body.amount); if (!answer) return out({ error: "回答不存在。" }, 404); if (answer.questionAuthorId !== user.id) return out({ error: "只有提问者可以发起议价。" }, 403); if (!Number.isInteger(amount) || amount < 0 || amount > 500) return out({ error: "议价金额应在 0–500 知点之间。" }, 400);
    const offer = { id: crypto.randomUUID(), answerId: answer.id, buyerId: user.id, sellerId: answer.authorId, amount, status: "pending", createdAt: new Date().toISOString() }; state.offers.push(offer); await save(state); return out({ offer }, 201);
  }
  if (body.action === "respondOffer") {
    const offer = state.offers.find((item) => item.id === String(body.offerId)), accept = Boolean(body.accept); if (!offer || offer.sellerId !== user.id) return out({ error: "没有处理该议价的权限。" }, 403); offer.status = accept ? "accepted" : "rejected"; offer.respondedAt = new Date().toISOString(); if (accept) { const answer = state.answers.find((item) => item.id === offer.answerId); if (answer) answer.price = offer.amount; } await save(state); return out({ offer });
  }
  if (body.action === "rateAndAcceptAnswer") {
    const answer = state.answers.find((item) => item.id === String(body.answerId)), rating = Number(body.accuracy), comment = clean(body.comment, 600); if (!answer || answer.questionAuthorId !== user.id) return out({ error: "只有提问者可以验收这个回答。" }, 403); if (!ownsUnlock(state, user.id, answer.id) && answer.price > 0) return out({ error: "请先解锁完整回答再验收。" }, 400); if (!Number.isInteger(rating) || rating < 1 || rating > 100) return out({ error: "准确度评分应在 1–100 之间。" }, 400);
    answer.accuracy = rating; answer.reviewComment = comment; answer.accepted = true; const question = state.questions.find((item) => item.id === answer.questionId); if (question) question.status = "solved"; let asset = state.assets.find((item) => item.answerId === answer.id); if (!asset) { asset = { id: crypto.randomUUID(), answerId: answer.id, questionId: answer.questionId, title: question?.title || "已解决问题", summary: answer.preview, content: answer.full, category: question?.category || "综合", authorId: answer.authorId, authorName: answer.authorName, price: Math.min(50, Math.max(0, Math.round(answer.price * .25))), evidence: answer.evidence, accuracy: rating, unlockCount: 0, status: "published", createdAt: new Date().toISOString() }; state.assets.unshift(asset); } await save(state); return out({ answer, asset });
  }
  if (body.action === "unlockKnowledgeAsset") {
    const asset = state.assets.find((item) => item.id === String(body.assetId)); if (!asset) return out({ error: "知识资产不存在。" }, 404); if (!ownsAsset(state, user.id, asset.id) && asset.authorId !== user.id && asset.price > 0) { if (me.credits < asset.price) return out({ error: "知点余额不足。" }, 400); me.credits -= asset.price; const creator = state.profiles[asset.authorId], royalty = Math.floor(asset.price * .8); if (creator) { creator.credits += royalty; creator.royaltyEarned = (creator.royaltyEarned || 0) + royalty; } state.communityFund += asset.price - royalty; state.assetUnlocks.push({ userId: user.id, assetId: asset.id, paid: asset.price, royalty, createdAt: new Date().toISOString() }); asset.unlockCount += 1; await save(state); } return out({ asset: { ...asset, unlocked: true }, credits: me.credits });
  }
  if (body.action === "updateProfile") {
    me.education = clean(body.education, 140) || me.education; await save(state); return out({ me: publicProfile(me) });
  }
  if (body.action === "myData") return out({ me: { ...publicProfile(me), royaltyEarned: me.royaltyEarned }, credits: me.credits, questions: state.questions.filter((item) => item.authorId === user.id), answers: state.answers.filter((item) => item.authorId === user.id), assets: state.assets.filter((item) => item.authorId === user.id), unlocks: state.unlocks.filter((item) => item.userId === user.id) });
  if (body.action === "reviewProfile") { if (!canReview(user)) return out({ error: "需要管理员权限。" }, 403); const target = state.profiles[clean(body.userId, 100)]; if (!target) return out({ error: "用户不存在。" }, 404); target.verified = Boolean(body.verified); await save(state); return out({ profile: publicProfile(target) }); }
  return out({ error: "未知操作" }, 400);
};
