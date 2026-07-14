const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
if (!$('#interactionStyles')) { const interactionStyles = document.createElement('link'); interactionStyles.id = 'interactionStyles'; interactionStyles.rel = 'stylesheet'; interactionStyles.href = 'interactions.css'; document.head.append(interactionStyles); }
const storeKey = 'zhitu-prototype-data';
const initialData = { submissions: [], clues: [], theme: 'study' };
const data = { ...initialData, ...JSON.parse(localStorage.getItem(storeKey) || '{}') };
const save = () => localStorage.setItem(storeKey, JSON.stringify(data));

function toast(message, action) {
  let node = $('#toast');
  if (!node) {
    node = document.createElement('div'); node.id = 'toast'; node.className = 'toast'; document.body.append(node);
  }
  node.innerHTML = `<span>${message}</span>${action ? `<button>${action.label}</button>` : ''}`;
  node.classList.add('show');
  if (action) $('button', node).onclick = action.onClick;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 4200);
}

function createDialog(id, title, hint, fields, submitText) {
  const dialog = document.createElement('dialog'); dialog.id = id;
  dialog.innerHTML = `<button class="close-dialog" aria-label="关闭">×</button><p class="eyebrow"><span></span> ZHITU / 互动原型</p><h2>${title}</h2><p class="dialog-intro">${hint}</p>${fields.map((f) => `<label>${f.label}${f.type === 'textarea' ? `<textarea name="${f.name}" placeholder="${f.placeholder}"></textarea>` : `<input name="${f.name}" placeholder="${f.placeholder}" />`}</label>`).join('')}<button class="primary-btn" data-submit>${submitText} <b>↗</b></button>`;
  document.body.append(dialog);
  $('.close-dialog', dialog).onclick = () => dialog.close();
  return dialog;
}

const themeNames = { study: '研究室', night: '深夜图书馆', workshop: '创作工坊' };
function setTheme(theme) {
  data.theme = theme; save(); document.body.dataset.theme = theme;
  const trigger = $('#themeTrigger'); if (trigger) trigger.innerHTML = `<span class="theme-dot"></span>${themeNames[theme]}`;
}
setTheme(data.theme);
$('#themeTrigger')?.addEventListener('click', (event) => { event.stopPropagation(); $('#themeMenu').hidden = !$('#themeMenu').hidden; });
$('#themeMenu')?.addEventListener('click', (event) => { const button = event.target.closest('button[data-theme]'); if (button) { setTheme(button.dataset.theme); $('#themeMenu').hidden = true; } });
document.addEventListener('click', (event) => { if (!$('#themeMenu')?.contains(event.target) && !$('#themeTrigger')?.contains(event.target)) $('#themeMenu').hidden = true; });

const askDialog = $('#askDialog');
function submitQuestion(type) {
  const dialog = type === 'stuck' ? $('#stuckDialog') : askDialog;
  const title = $('input', dialog)?.value.trim(); const help = $('textarea', dialog)?.value.trim();
  if (!title || !help) return toast('还差一点：请写下你的卡点和需要的帮助。');
  const submission = { id: Date.now(), title, help, type, status: 'pending', created: new Date().toLocaleDateString('zh-CN') };
  data.submissions.unshift(submission); save(); dialog.close(); renderAll();
  toast('已投递给编辑部，先进入核验队列。', { label: '查看审核进度', onClick: openReviewDrawer });
}
$('#askButton')?.addEventListener('click', () => askDialog.showModal());
$('#submitQuestion')?.addEventListener('click', () => submitQuestion('question'));
$('#stuckButton')?.addEventListener('click', () => $('#stuckDialog').showModal());
$('#submitStuck')?.addEventListener('click', () => submitQuestion('stuck'));
$$('.close-dialog').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));

function boardCard(item) {
  return `<article class="queued-card ${item.status}"><div><span>${item.type === 'stuck' ? '卡关档案' : '悬赏问题'} · ${item.created}</span><b>${item.status === 'approved' ? '已精选' : '审核中'}</b></div><h3>${item.title}</h3><p>${item.help}</p><button data-open-submission="${item.id}">${item.status === 'approved' ? '进入破局现场 →' : '查看审核状态 →'}</button></article>`;
}
function renderAll() {
  const list = $('#submissionList');
  if (list) list.innerHTML = data.submissions.map(boardCard).join('');
  const approved = data.submissions.filter((item) => item.status === 'approved' && item.type === 'stuck');
  const board = $('.case-board');
  board?.querySelectorAll('.user-case-card').forEach((node) => node.remove());
  approved.slice(0, 2).forEach((item, index) => {
    const card = document.createElement('button'); card.className = `user-case-card position-${index}`; card.dataset.openSubmission = item.id;
    card.innerHTML = `<span>新收录 / ${item.created}</span><h3>${item.title}</h3><p>${item.help}</p><b>查看线索 →</b>`; board.append(card);
  });
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-open-submission]'); if (!target) return;
  const item = data.submissions.find((entry) => entry.id === Number(target.dataset.openSubmission));
  if (!item) return;
  localStorage.setItem('zhitu-active-case', JSON.stringify(item)); window.location.href = 'case.html?case=custom';
});

function openReviewDrawer() {
  let drawer = $('#reviewDrawer');
  if (!drawer) {
    drawer = document.createElement('aside'); drawer.id = 'reviewDrawer'; drawer.className = 'review-drawer'; document.body.append(drawer);
    drawer.addEventListener('click', (event) => {
      if (event.target.matches('[data-approve]')) { const item = data.submissions.find((entry) => entry.id === Number(event.target.dataset.approve)); item.status = 'approved'; save(); renderAll(); openReviewDrawer(); toast('核验完成，卡点已进入卡关现场。'); }
      if (event.target.matches('[data-close-drawer]')) drawer.classList.remove('open');
    });
  }
  drawer.innerHTML = `<header><span>编辑部 / 核验队列</span><button data-close-drawer>×</button></header><p>这是原型中的审核工作台。通过后，卡点才会进入公开的卡关现场。</p><div class="review-list">${data.submissions.length ? data.submissions.map((item) => `<article><small>${item.type === 'stuck' ? '卡关投稿' : '求解问题'} · ${item.created}</small><h3>${item.title}</h3><p>${item.help}</p>${item.status === 'pending' ? `<button data-approve="${item.id}">核验通过并精选</button>` : '<b>✓ 已进入公开现场</b>'}</article>`).join('') : '<div class="empty-state">暂时没有待核验投稿。<br />发布一个问题或卡点试试。</div>'}</div>`;
  drawer.classList.add('open');
}
$('.avatar')?.addEventListener('click', openReviewDrawer);

$$('.subject-tabs button').forEach((tab) => tab.addEventListener('click', () => {
  $$('.subject-tabs button').forEach((button) => button.classList.toggle('selected', button === tab));
  const label = tab.textContent.trim();
  $$('.question-card').forEach((card) => { card.hidden = label !== '全部' && !card.textContent.includes(label); });
}));

$('.folder-stack')?.addEventListener('click', () => {
  $('.folder-stack').classList.toggle('expanded');
  toast($('.folder-stack').classList.contains('expanded') ? '资料包已展开：每条结论都可以回到来源。' : '已收起资料包。');
});
const discussionDialog = createDialog('discussionDialog', '加入一场精选讨论', '留下可被追问的观点、证据或方法。水贴不会进入公开讨论区。', [{ label: '你的回应', name: 'reply', type: 'textarea', placeholder: '写下你的判断、经验或资料依据。' }], '提交给编辑部');
$$('.forum-list article').forEach((topic) => topic.addEventListener('click', () => { $('#discussionDialog h2').textContent = `讨论：${$('h3', topic).textContent}`; discussionDialog.showModal(); }));
$('[data-submit]', discussionDialog).addEventListener('click', () => { if (!$('[name="reply"]', discussionDialog).value.trim()) return toast('请先写下你的观点或依据。'); discussionDialog.close(); toast('回应已提交，编辑部会在核验后展示。'); });

function setupCasePage() {
  const custom = JSON.parse(localStorage.getItem('zhitu-active-case') || 'null');
  if (custom && $('.case-page')) {
    $('.case-hero-detail h1').innerHTML = `${custom.title}<br /><i>正在等待第一条破局线索。</i>`;
    $('.detail-lead').textContent = custom.help;
    $('.case-story').innerHTML = `<section><p class="story-label">01 / 我卡在哪里</p><p>${custom.help}</p></section><section><p class="story-label">02 / 编辑部提示</p><p>这个卡点已通过基础核验。请提供具体方法、可靠资料或可执行的下一步，避免空泛安慰。</p></section>`;
  }
  const clueDialog = createDialog('clueDialog', '留下一条破局线索', '好的线索应当能让提问者立刻知道下一步怎么走。', [{ label: '你的线索标题', name: 'title', placeholder: '例如：先把问题缩成可检验的一条路径' }, { label: '具体建议或资料依据', name: 'body', type: 'textarea', placeholder: '写下方法、步骤、资料出处或你的判断依据。' }], '提交线索');
  $('.add-clue')?.addEventListener('click', () => clueDialog.showModal());
  $('[data-submit]', clueDialog).addEventListener('click', () => {
    const title = $('[name="title"]', clueDialog).value.trim(); const body = $('[name="body"]', clueDialog).value.trim();
    if (!title || !body) return toast('请补全线索标题与具体建议。');
    data.clues.unshift({ id: Date.now(), title, body, liked: false, accepted: false }); save(); clueDialog.close(); renderClues(); toast('线索已提交，感谢你让一个卡点变得可前进。');
  });
  renderClues();
}
function renderClues() {
  const panel = $('.clue-panel'); if (!panel) return;
  panel.querySelectorAll('.user-clue').forEach((node) => node.remove());
  data.clues.forEach((clue) => {
    const item = document.createElement('article'); item.className = 'clue user-clue'; item.innerHTML = `<p>社区线索 · 刚刚提交</p><h3>${clue.title}</h3><p>${clue.body}</p><div><button data-like="${clue.id}">${clue.liked ? '♥ 已认可' : '♡ 认可线索'}</button><button data-accept="${clue.id}">${clue.accepted ? '✓ 已采纳' : '采纳线索'}</button></div>`;
    $('.add-clue', panel).before(item);
  });
  $('.clue-title b').textContent = 18 + data.clues.length;
}
document.addEventListener('click', (event) => {
  const like = event.target.closest('[data-like]'); const accept = event.target.closest('[data-accept]');
  if (like) { const clue = data.clues.find((item) => item.id === Number(like.dataset.like)); clue.liked = !clue.liked; save(); renderClues(); }
  if (accept) { const clue = data.clues.find((item) => item.id === Number(accept.dataset.accept)); clue.accepted = true; save(); renderClues(); toast('已采纳。这条线索会进入该问题的破局路径。'); }
});

renderAll(); setupCasePage();
