'use strict';
(() => {
  const E = Doubles, $ = id => document.getElementById(id), storageKey = 'doubles-club-v1';
  let state = E.emptyState(), history = [], storageFailed = false;
  const clone = value => JSON.parse(JSON.stringify(value));
  let manualRounds = null;
  let currentView = 'setup';
  const scrollPositions = { setup: null, results: null };
  const pendingRelay = () => !state.completed && state.raw !== state.parsedRaw;
  const timeProblem = () => E.timeProblem(state.settings);
  function setView(view, { reset = false } = {}) {
    scrollPositions[currentView] = window.scrollY;
    currentView = view;
    const workspace = document.querySelector('.workspace');
    workspace.dataset.view = view;
    $('tab-setup').setAttribute('aria-pressed', String(view === 'setup'));
    $('tab-results').setAttribute('aria-pressed', String(view === 'results'));
    updateMobileAction();
    const top = workspace.getBoundingClientRect().top + window.scrollY - document.querySelector('.view-tabs').offsetHeight;
    window.scrollTo({ top: reset ? top : scrollPositions[view] ?? top, behavior: 'auto' });
  }
  function updateMobileAction() {
    const b = $('mobile-primary'), problem = timeProblem();
    b.disabled = false;
    if (pendingRelay()) b.textContent = '接龙已修改 · 重新识别名单';
    else if (currentView === 'results' && state.schedule.length) b.textContent = problem ? '返回设置核对活动时间' : state.stale ? '赛程待更新 · 返回设置' : $('scope').value === 'all' ? '复制完整赛程群通知' : `复制第 ${Number($('scope').value) + 1} 轮群通知`;
    else if (problem) { b.textContent = '请先核对活动时间'; b.disabled = true; }
    else b.textContent = state.people.length ? $('generate').textContent : '识别接龙名单';
  }
  function notify(message, error = false) { $('notice-text').textContent = message; $('notice').className = `notice${error ? ' error' : ''}`; $('notice').hidden = !message; clearTimeout(notify.timer); if (message && !error) notify.timer = setTimeout(() => { $('notice').hidden = true; }, 5500); }
  function remember() { history.push(clone(state)); if (history.length > 20) history.shift(); }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(state)); storageFailed = false; }
    catch { storageFailed = true; }
    $('save-status').textContent = storageFailed ? '本机保存不可用，请导出备份' : '草稿已保存在当前浏览器';
  }
  function mutate(change, stale = false, { keepRoster = false } = {}) { remember(); change(); if (stale && state.schedule.length) state.stale = true; save(); render({ keepRoster }); }
  function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
  function button(text, className, click) { const b = node('button', className, text); b.type = 'button'; b.addEventListener('click', click); return b; }
  function toggle(label, checked, change, className = '') {
    const wrap = node('label', `check-label ${className}`), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked; input.addEventListener('change', () => change(input.checked));
    wrap.append(input, document.createTextNode(label)); return wrap;
  }
  function renderRoster() {
    const roster = $('roster'); roster.replaceChildren();
    state.people.forEach((p, index) => {
      const item = node('div', 'person'), row = node('div', 'person-row');
      const name = document.createElement('input'); name.type = 'text'; name.value = p.name; name.maxLength = 100; name.setAttribute('aria-label', `第 ${index + 1} 位参赛者姓名`);
      name.addEventListener('change', () => mutate(() => {
        p.name = name.value.trim(); name.value = p.name;
        item.querySelector('.remove').setAttribute('aria-label', `移除 ${p.name || '参赛者'}`);
      }, true, { keepRoster: true }));
      const remove = button('×', 'remove', () => {
        const played = state.schedule.some(r => r.matches.some(m => m.teams.flat().includes(p.id)));
        if (played) { mutate(() => { p.active = false; }, true); notify('此人已有赛程记录，已保留记录并移出后续比赛。'); }
        else mutate(() => { state.people = state.people.filter(person => person.id !== p.id); }, true);
      });
      remove.setAttribute('aria-label', `移除 ${p.name || '参赛者'}`);
      row.append(node('span', 'person-index', String(index + 1).padStart(2, '0')), name, toggle('参与', p.active, checked => mutate(() => { p.active = checked; }, true, { keepRoster: true })), remove);
      item.append(row);
      if (p.note) item.append(node('p', 'person-note', p.note));
      if (p.note || !p.confirmed) item.append(toggle('已核对为一位独立参赛者', p.confirmed, checked => mutate(() => { p.confirmed = checked; }, true, { keepRoster: true }), 'confirm-label'));
      roster.append(item);
    });
  }
  function renderSchedule() {
    const exists = state.schedule.length > 0;
    $('empty').hidden = exists; $('schedule-section').hidden = !exists; $('stale').hidden = !state.stale;
    $('schedule-meta').textContent = exists ? `已完成 ${state.completed} / ${state.schedule.length} 轮` : '';
    const container = $('schedule'); container.replaceChildren();
    if (!exists) return;
    const names = Object.fromEntries(state.people.map(p => [p.id, p.name]));
    const used = new Set(state.schedule.flatMap(r => r.matches.flatMap(m => m.teams.flat())));
    $('stat-people').textContent = used.size;
    $('stat-rounds').textContent = state.schedule.length;
    $('stat-matches').textContent = state.schedule.reduce((n, r) => n + r.matches.length, 0);
    state.schedule.forEach((round, index) => {
      const section = node('section', `round${index < state.completed ? ' completed' : ''}`);
      const head = node('div', 'round-head'), title = node('h3', '', `第 ${String(index + 1).padStart(2, '0')} 轮`);
      if (index < state.completed) title.append(node('small', '', '已完成 · 已锁定'));
      head.append(title);
      if (index === state.completed) { const done = button('标记本轮完成', 'text-button', completeRound); done.disabled = state.stale || pendingRelay(); head.append(done); }
      const list = node('div');
      round.matches.forEach(match => {
        const card = node('div', 'match');
        card.append(node('span', 'court', `${String(match.court).padStart(2, '0')} 号场`), node('span', 'team', match.teams[0].map(id => names[id] || '已移除').join(' / ')), node('span', 'vs', 'VS'), node('span', 'team', match.teams[1].map(id => names[id] || '已移除').join(' / ')));
        list.append(card);
      });
      section.dataset.round = String(index); section.append(head, list); container.append(section);
    });
    const s = E.stats(state.people, state.schedule), activeCounts = state.people.filter(p => p.active).map(p => s.counts[p.id] || 0);
    const repeats = [...s.partners.values()].reduce((n, count) => n + Math.max(0, count - 1), 0);
    const diff = activeCounts.length ? Math.max(...activeCounts) - Math.min(...activeCounts) : 0;
    $('quality').textContent = `当前参与者上场次数相差 ${diff} 场。重复搭档累计 ${repeats} 次。搭档与对手采用有限搜索，不保证全局最优。`;
    const stats = $('stats-list'); stats.replaceChildren();
    const max = Math.max(1, ...Object.values(s.counts));
    state.people.forEach(p => {
      const row = node('div', 'stat-row'), bar = node('span', 'stat-bar'), fill = node('i');
      fill.style.width = `${(s.counts[p.id] || 0) / max * 100}%`; bar.setAttribute('aria-hidden', 'true'); bar.append(fill);
      row.append(node('span', '', p.name + (p.active ? '' : '（已退出）')), bar, node('span', '', `${s.counts[p.id] || 0} 场`)); stats.append(row);
    });
    const scope = $('scope'), oldScope = scope.value; scope.replaceChildren(new Option('完整赛程', 'all'));
    state.schedule.forEach((_, i) => scope.add(new Option(`第 ${i + 1} 轮`, String(i))));
    scope.value = [...scope.options].some(o => o.value === oldScope) ? oldScope : 'all';
    const filter = $('view-round'), previous = filter.value; filter.replaceChildren(new Option('全部轮次', 'all')); state.schedule.forEach((_, i) => filter.add(new Option(`第 ${i + 1} 轮`, String(i)))); filter.value = [...filter.options].some(o => o.value === previous) ? previous : 'all'; filterRounds();
    updateOutput();
  }
  function filterRounds() { document.querySelectorAll('#schedule .round').forEach(r => { r.hidden = $('view-round').value !== 'all' && r.dataset.round !== $('view-round').value; }); }
  function updateOutput() {
    const problem = timeProblem();
    $('generate').disabled = Boolean(problem);
    $('copy').disabled = state.stale || pendingRelay() || Boolean(problem) || !state.schedule.length;
    updateMobileAction();
    $('append-rounds').disabled = state.stale || pendingRelay() || Boolean(problem) || state.schedule.length >= E.MAX_ROUNDS;
    document.querySelectorAll('.round-head button').forEach(button => { button.disabled = state.stale || pendingRelay() || Boolean(problem); });
    $('output').value = problem || (pendingRelay() ? '接龙已修改，请重新识别名单并生成赛程后复制。' : state.stale ? '赛程待更新，请重新生成后复制。' : E.groupText(state.people, state.settings, state.schedule, $('scope').value));
  }
  function recalculateRounds() {
    if (state.settings.roundMode === 'auto') {
      const estimate = E.estimateRounds(state.settings.durationMinutes, state.settings.matchMinutes);
      state.settings.rounds = Math.min(E.MAX_ROUNDS, Math.max(estimate.totalRounds, state.completed ? state.completed + 4 : 1));
    }
  }
  function renderEstimate() {
    const auto = state.settings.roundMode === 'auto'; $('rounds').readOnly = auto;
    $('durationMinutes').disabled = !auto; $('matchMinutes').disabled = !auto;
    const problem = timeProblem(), range = E.parseTime(state.settings.time);
    $('durationMinutes').setAttribute('aria-invalid', String(Boolean(problem)));
    $('time-status').textContent = problem || (state.timeSource === 'retained'
      ? '本次未识别到时间，正在沿用已有设置，请核对活动时间和可打球时长。'
      : range ? `活动时段共 ${range.durationMinutes} 分钟；可打球时长用于排轮，可扣除热身和休息。`
        : '未识别到有效时间范围，请手动核对可打球时长。');
    $('time-status').classList.toggle('time-warning', Boolean(problem) || state.timeSource === 'retained');
    $('generate').disabled = Boolean(problem);
    $('append-rounds').disabled = state.stale || pendingRelay() || Boolean(problem) || state.schedule.length >= E.MAX_ROUNDS;
    if (!auto) { $('round-estimate').textContent = '手动设置轮数。活动结束时可随时停止，也可继续补轮。'; return; }
    try {
      const e = E.estimateRounds(state.settings.durationMinutes, state.settings.matchMinutes), people = state.people.filter(p => p.active).length;
      const matches = Math.min(Number(state.settings.courts), Math.floor(people / 4));
      const perPerson = people >= 4 ? `每人预计约 ${(e.estimatedRounds * matches * 4 / people).toFixed(1)} 场。` : '识别名单后显示每人预计场次。';
      $('round-estimate').textContent = `预计正常打 ${e.estimatedRounds} 轮，预排 ${state.settings.rounds} 轮（含备用）。${perPerson}平均用时含换场和短休，多块场地同时比赛算一轮。到时间就停止，无需全部打完。`;
    } catch (error) { $('round-estimate').textContent = error.message; }
    $('append-rounds').disabled = state.stale || pendingRelay() || Boolean(problem) || state.schedule.length >= E.MAX_ROUNDS;
  }
  function completeRound() {
    if (state.stale || pendingRelay() || timeProblem()) return;
    try {
      const singleRound = $('view-round').value !== 'all';
      let extended = null;
      if (state.settings.roundMode === 'auto' && state.schedule.length - state.completed - 1 <= 2 && state.schedule.length < E.MAX_ROUNDS) extended = E.appendRounds(state.people, state.settings, state.schedule, Math.min(4, E.MAX_ROUNDS - state.schedule.length));
      const added = extended ? extended.length - state.schedule.length : 0;
      mutate(() => { state.completed++; if (extended) { state.schedule = extended; state.settings.rounds = extended.length; } });
      if (singleRound && state.completed < state.schedule.length) selectRound(state.completed);
      if (added) notify(`本轮已完成，已自动补充后续 ${added} 轮。到时间即可停止。`);
      else if (state.completed === state.schedule.length) notify('全部预排轮次已完成。需要继续时，可点击「再补 4 轮」。');
    } catch (error) { notify(error.message, true); }
  }
  function selectRound(index) {
    $('view-round').value = String(index); $('scope').value = String(index);
    filterRounds(); updateOutput();
  }
  function render({ keepRoster = false } = {}) {
    $('raw').value = state.raw; $('raw').disabled = state.completed > 0; $('sample').disabled = state.completed > 0; $('parse').disabled = state.completed > 0; $('raw').title = state.completed ? '已有完成轮次，请通过名单添加、编辑或取消参与。' : ''; 
    for (const [field, value] of Object.entries(state.settings)) $(field).value = value;
    $('undo').disabled = !history.length;
    $('parse').textContent = state.completed ? '历史已锁定' : '识别名单';
    $('generate').textContent = state.completed ? '保留已完成轮次，重排后续' : state.schedule.length ? '重新生成赛程 ↗' : '生成多轮赛程 ↗';
    $('roster-section').hidden = !state.people.length;
    $('people-count').textContent = state.people.filter(p => p.active).length;
    if (!keepRoster) renderRoster();
    renderSchedule(); renderEstimate(); updateMobileAction();
  }
  $('raw').addEventListener('input', () => { state.raw = $('raw').value; save(); updateOutput(); });
  $('sample').addEventListener('click', () => { mutate(() => { state.raw = E.SAMPLE; }); notify('已填入你的接龙示例，点击「识别名单」继续。'); });
  $('parse').addEventListener('click', () => {
    if (state.completed) { notify('已完成轮次已锁定。请直接添加、编辑或取消参与，保留历史记录。', true); return; }
    const parsed = E.parseRelay(state.raw);
    if (!parsed.people.length) { notify('未识别到参赛者。请使用「1. 姓名」格式。', true); return; }
    if (parsed.people.length > E.MAX_PEOPLE) { notify(`最多支持 ${E.MAX_PEOPLE} 位参赛者。`, true); return; }
    mutate(() => { state.people = parsed.people; state.parsedRaw = state.raw; state.schedule = []; state.stale = false; state.timeSource = parsed.time ? 'relay' : 'retained'; if (parsed.time) state.settings.time = parsed.time; if (parsed.durationMinutes) state.settings.durationMinutes = parsed.durationMinutes; recalculateRounds(); });
    scrollPositions.results = null;
    $('source-details').hidden = false;
    $('parse-details').textContent = `${parsed.ignored.length ? `未作为名单导入：${parsed.ignored.join('；')}。` : ''}${parsed.time ? '已识别时间，请核对；日期和地点请手动填写。' : '本次未识别到时间，沿用已有设置，请核对活动时间和可打球时长。'}`;
    notify(`已识别 ${parsed.people.length} 人${parsed.people.some(p => !p.confirmed) ? '，有待核对项' : ''}。${parsed.time ? '请核对名单后生成赛程。' : '本次未识别到时间，请核对沿用的设置。'}`);
  });
  $('add').addEventListener('click', () => {
    if (state.people.length >= E.MAX_PEOPLE) { notify(`最多支持 ${E.MAX_PEOPLE} 位参赛者。`, true); return; }
    mutate(() => state.people.push({ id: E.id(), name: '', active: true, confirmed: true, note: '' }), true);
    $('roster').lastElementChild.querySelector('input').focus();
  });
  for (const field of Object.keys(state.settings)) $(field).addEventListener('change', () => {
    let value = $(field).value;
    if (['courts', 'rounds', 'durationMinutes', 'matchMinutes'].includes(field)) {
      value = Number(value); const limits = {courts:[1,16], rounds:[1,E.MAX_ROUNDS], durationMinutes:[5,720], matchMinutes:[3,120]}, [min,max] = limits[field];
      if (!Number.isInteger(value) || value < min || value > max) { $(field).value = state.settings[field]; notify(`请输入 ${min}–${max} 的整数。`, true); return; }
    }
    mutate(() => {
      if (field === 'roundMode' && value === 'auto') manualRounds = state.settings.rounds;
      state.settings[field] = value;
      if (field === 'time' || field === 'durationMinutes') state.timeSource = 'manual';
      if (field === 'roundMode' && value === 'manual' && manualRounds !== null) state.settings.rounds = manualRounds;
      if (field === 'time') { const parsed = E.parseTime(value); if (parsed) { state.settings.time = parsed.time; state.settings.durationMinutes = parsed.durationMinutes; } }
      if (['roundMode','durationMinutes','matchMinutes','time'].includes(field)) recalculateRounds();
    }, ['courts','rounds','roundMode','durationMinutes','matchMinutes','time'].includes(field));
  });
  $('append-rounds').addEventListener('click', () => {
    if (state.stale || pendingRelay() || timeProblem()) return;
    try { const advance = state.completed === state.schedule.length && $('view-round').value !== 'all'; const schedule = E.appendRounds(state.people, state.settings, state.schedule, Math.min(4, E.MAX_ROUNDS - state.schedule.length)); mutate(() => { state.schedule = schedule; state.settings.rounds = schedule.length; }); if (advance) selectRound(state.completed); notify('已补充后续轮次，现有对阵保持不变。到时间即可停止。'); }
    catch (error) { notify(error.message, true); }
  });
  $('generate').addEventListener('click', () => {
    if (state.raw !== state.parsedRaw && !state.completed) { notify('接龙原文已修改。请先重新识别并核对名单，再生成赛程。', true); return; }
    try {
      const schedule = E.generate(state.people, state.settings, state.schedule.slice(0, state.completed));
      mutate(() => { state.schedule = schedule; state.stale = false; });
      notify(`已生成 ${schedule.length} 轮赛程${state.completed ? `，前 ${state.completed} 轮保持锁定` : ''}。可在下方复制群通知。`);
      setView('results', { reset: true });
    } catch (error) { notify(error.message, true); }
  });
  $('tab-setup').addEventListener('click', () => setView('setup'));
  $('tab-results').addEventListener('click', () => setView('results'));
  $('mobile-primary').addEventListener('click', () => { if (state.raw !== state.parsedRaw && !state.completed) { setView('setup'); $('parse').click(); return; } if (currentView === 'results' && state.schedule.length) { if (state.stale || timeProblem()) setView('setup'); else $('copy').click(); } else $(state.people.length ? 'generate' : 'parse').click(); });
  $('view-round').addEventListener('change', () => { filterRounds(); $('scope').value = $('view-round').value; updateOutput(); });
  $('scope').addEventListener('change', updateOutput);
  function updateKeyboardState() {
    const viewport = window.visualViewport, active = document.activeElement;
    const editable = active && (active.isContentEditable || active.matches('textarea:not([readonly]):not(:disabled), input:not([readonly]):not(:disabled):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit])'));
    const open = viewport && editable && Math.abs(viewport.scale - 1) < 0.05 && window.innerHeight - viewport.height > 140;
    document.body.classList.toggle('keyboard-open', Boolean(open));
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', updateKeyboardState);
  document.addEventListener('focusin', updateKeyboardState);
  document.addEventListener('focusout', () => requestAnimationFrame(updateKeyboardState));
  window.addEventListener('resize', updateKeyboardState);
  $('notice-dismiss').addEventListener('click', () => { clearTimeout(notify.timer); $('notice').hidden = true; });
  $('copy').addEventListener('click', async () => {
    if (state.stale || pendingRelay() || timeProblem() || !state.schedule.length) return;
    try {
      await navigator.clipboard.writeText($('output').value);
      notify('群通知已复制。请粘贴到微信群发送。');
    } catch {
      $('output').focus(); $('output').select(); $('output').setSelectionRange(0, $('output').value.length);
      notify('自动复制不可用，已选中文本。请长按复制，或按 Ctrl/Cmd+C。');
    }
  });
  $('undo').addEventListener('click', () => { if (!history.length) return; state = history.pop(); save(); render(); $('source-details').hidden = true; notify('已撤销上一步操作。'); });
  $('export').addEventListener('click', () => {
    const file = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(file), link = document.createElement('a');
    link.href = url; link.download = `羽毛球活动-${state.settings.date || '草稿'}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出活动备份，可在其他设备导入。');
  });
  $('import').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async () => {
    const file = $('file').files[0]; if (!file) return;
    try {
      if (file.size > 8000000) throw new Error('备份文件不能超过 8 MB。');
      const imported = E.readBackup(JSON.parse(await file.text()));
      mutate(() => { state = imported; }); $('source-details').hidden = true; notify('已导入活动备份。可撤销此次导入。');
    } catch (error) { notify(`导入失败：${error.message}`, true); }
    $('file').value = '';
  });
  $('clear').addEventListener('click', () => {
    if (!window.confirm('清空当前名单、设置和赛程？需要保留时，请先导出备份。')) return;
    mutate(() => { state = E.emptyState(); }); $('source-details').hidden = true; notify('已清空，可点击「撤销」恢复。');
  });
  try { const saved = localStorage.getItem(storageKey); if (saved) state = E.readBackup(JSON.parse(saved)); }
  catch { notify('本机草稿不可用或格式无效。可重新粘贴接龙，或导入备份。', true); }
  render();
})();
