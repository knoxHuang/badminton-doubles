const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
function rng(seed = 42) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }; }
function players(n) { return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `球友${i + 1}`, active: true, confirmed: true, note: '' })); }

test('用户接龙：八人、大小写、时间，具体日期不推断', () => {
  const parsed = E.parseRelay(E.SAMPLE);
  assert.deepEqual(parsed.people.map(p => p.name), ['panda', '茶米', 'Knox', 'Syllabear', 'Reus', '长华', '云朵', '歪西']);
  assert.equal(parsed.time, '周二 19:00–21:00');
  assert.equal(parsed.durationMinutes, 120);
  assert.equal(new Set(parsed.people.map(p => p.id)).size, 8);
  assert.ok(parsed.people.every(p => p.confirmed));
});
test('不同编号、同名、多人报名与非编号名单', () => {
  const parsed = E.parseRelay('#接龙\n1、云朵\n2. 云朵\n3）panda +1\n4. Knox 候补\n5. 茶米');
  assert.equal(parsed.people.length, 5);
  assert.deepEqual(parsed.people.map(p => p.confirmed), [false, false, false, false, true]);
  assert.deepEqual(E.parseRelay('接龙\n周二晚 7-9\npanda\n茶米').people.map(p => p.name), ['panda', '茶米']);
  assert.equal(E.parseRelay('#接龙\n周二晚 7-9').people.length, 0);
});
test('不同人数及场地：同轮不撞人，上场次数差不超过一', () => {
  for (let n = 4; n <= 25; n++) for (const courts of [1, 2, 4, 16]) {
    const p = players(n), settings = { courts, rounds: 13 };
    const schedule = E.generate(p, settings, [], rng(n * courts));
    assert.equal(schedule.length, 13);
    for (const round of schedule) {
      assert.equal(round.matches.length, Math.min(courts, Math.floor(n / 4)));
      const ids = round.matches.flatMap(m => m.teams.flat());
      assert.equal(new Set(ids).size, ids.length);
      assert.ok(round.matches.every(m => m.teams.length === 2 && m.teams.every(t => t.length === 2)));
    }
    const counts = Object.values(E.stats(p, schedule).counts);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${n} 人 ${courts} 场地`);
  }
});
test('八人七轮：每人七场，换搭档，群文本没有轮空信息', () => {
  const p = E.parseRelay(E.SAMPLE).people, settings = { ...E.emptyState().settings, time: '周二 19:00–21:00', roundMode: 'manual', rounds: 7 };
  const schedule = E.generate(p, settings, [], rng());
  const s = E.stats(p, schedule);
  assert.ok(Object.values(s.counts).every(c => c === 7));
  assert.ok(s.partners.size >= 20, '应产生多种搭档组合');
  const text = E.groupText(p, settings, schedule);
  assert.ok(text.includes('panda') && text.includes('周二 19:00–21:00'));
  assert.ok(!text.includes('轮空'));
  const single = E.groupText(p, settings, schedule, '2');
  assert.ok(single.includes('第 3 轮'));
  assert.ok(!single.includes('第 1 轮'));
});
test('退出和新增：锁定已完成轮次，只重排后续', () => {
  const p = players(9), settings = { courts: 2, rounds: 9 };
  const first = E.generate(p, settings, [], rng());
  const locked = JSON.parse(JSON.stringify(first.slice(0, 2)));
  p[0].active = false;
  p.push({ id: 'new', name: '新人', active: true, confirmed: true });
  const result = E.generate(p, settings, locked, rng());
  assert.deepEqual(result.slice(0, 2), locked);
  assert.deepEqual(first.slice(0, 2), locked);
  assert.ok(result.slice(2).every(r => !r.matches.some(m => m.teams.flat().includes('p0'))));
  assert.ok(result.slice(2).some(r => r.matches.some(m => m.teams.flat().includes('new'))));
});
test('输入边界：拒绝不足四人、未确认、同名、非法轮数和场地', () => {
  const settings = { courts: 2, rounds: 7 };
  assert.throws(() => E.generate(players(3), settings), /至少/);
  const p = players(4); p[0].confirmed = false;
  assert.throws(() => E.generate(p, settings), /确认/); p[0].confirmed = true;
  p[0].name = p[1].name; assert.throws(() => E.generate(p, settings), /同名/);
  for (const courts of [0, 1.5, NaN, 17]) assert.throws(() => E.generate(players(4), { ...settings, courts }), /场地/);
  for (const rounds of [0, 2.5, E.MAX_ROUNDS + 1]) assert.throws(() => E.generate(players(4), { ...settings, rounds }), /轮数/);
  const schedule = E.generate(players(4), { courts: 1, rounds: 1 });
  assert.throws(() => E.generate(players(4), { courts: 1, rounds: 1 }, schedule), /已完成/);
});
test('备份往返、待更新状态，拒绝损坏文件和同轮重复参赛', () => {
  const state = E.emptyState(); state.people = players(8); state.schedule = E.generate(state.people, state.settings, [], rng());
  assert.deepEqual(E.readBackup(JSON.parse(JSON.stringify(state))), state);
  const broken = JSON.parse(JSON.stringify(state)); broken.schedule[0].matches[0].teams[0][0] = 'missing';
  assert.throws(() => E.readBackup(broken), /不存在/);
  const duplicate = JSON.parse(JSON.stringify(state)); duplicate.schedule[0].matches[1].teams[0][0] = duplicate.schedule[0].matches[0].teams[0][0];
  assert.throws(() => E.readBackup(duplicate), /重复/);
  assert.throws(() => E.readBackup({}), /不是有效/);
  state.people[0].active = false; assert.equal(E.readBackup(state).stale, true);
});
test('原文识别状态可备份，兼容旧版备份', () => {
  const state = E.emptyState(); state.raw = E.SAMPLE; state.parsedRaw = E.SAMPLE;
  state.raw += '\n9. 新人';
  const restored = E.readBackup(JSON.parse(JSON.stringify(state)));
  assert.notEqual(restored.raw, restored.parsedRaw);
  delete state.parsedRaw;
  assert.equal(E.readBackup(state).parsedRaw, state.raw);
});
test('时间范围支持波浪线、分钟、跨午夜，拒绝无效时钟和误读日期', () => {
  assert.deepEqual(E.parseTime('周二晚 7 ~ 9'), { time: '周二 19:00–21:00', durationMinutes: 120 });
  assert.deepEqual(E.parseTime('7～9'), { time: '07:00–09:00', durationMinutes: 120 });
  assert.deepEqual(E.parseTime('时间：19:30–21:00'), { time: '19:30–21:00', durationMinutes: 90 });
  assert.deepEqual(E.parseTime('晚上11-凌晨1'), { time: '23:00–01:00', durationMinutes: 120 });
  for (const text of ['2026-11-10', '19:60-21:00', '25-27', '19-19', '暂无时间']) assert.equal(E.parseTime(text), null, text);
});
test('120分钟按平均用时估算，并至少预留四轮', () => {
  assert.deepEqual(E.estimateRounds(120, 15), { estimatedRounds: 8, reserveRounds: 4, totalRounds: 12 });
  assert.deepEqual(E.estimateRounds(120, 10), { estimatedRounds: 12, reserveRounds: 4, totalRounds: 16 });
  assert.deepEqual(E.estimateRounds(120, 20), { estimatedRounds: 6, reserveRounds: 4, totalRounds: 10 });
  assert.deepEqual(E.estimateRounds(125, 15), { estimatedRounds: 9, reserveRounds: 4, totalRounds: 13 });
  assert.deepEqual(E.estimateRounds(300, 10), { estimatedRounds: 30, reserveRounds: 8, totalRounds: 38 });
  for (const duration of [0, 4, 721, NaN]) assert.throws(() => E.estimateRounds(duration, 15), /活动时长/);
  for (const average of [0, 2, 121, NaN]) assert.throws(() => E.estimateRounds(120, average), /平均/);
});
test('追加轮次保留所有已有对阵，并继续均衡场次', () => {
  const p = players(9), settings = { ...E.emptyState().settings };
  const initial = E.generate(p, settings, [], rng());
  const extended = E.appendRounds(p, settings, initial, 4, rng(7));
  assert.equal(extended.length, 16);
  assert.deepEqual(extended.slice(0, 12), initial);
  const counts = Object.values(E.stats(p, extended).counts);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  const text = E.groupText(p, settings, extended);
  assert.ok(text.includes('预排 16 轮') && text.includes('到时间停止'));
  assert.ok(!text.includes('轮空'));
});
test('旧版七轮草稿转为自动预排，进行中的旧活动保留手动设置', () => {
  const state = E.emptyState();
  state.settings = { title: '羽毛球双打', date: '', time: '周二 19:00–21:00', location: '', notes: '', courts: 2, rounds: 7 };
  state.people = players(8); state.schedule = E.generate(state.people, state.settings, [], rng());
  const updated = E.readBackup(state);
  assert.equal(updated.settings.roundMode, 'auto');
  assert.equal(updated.settings.rounds, 12); assert.equal(updated.stale, true);
  state.completed = 1;
  const inProgress = E.readBackup(state);
  assert.equal(inProgress.settings.roundMode, 'manual');
  assert.equal(inProgress.settings.rounds, 7); assert.equal(inProgress.completed, 1);
});
test('打球时长超过活动时段时拒绝排赛，短用时在通知中明确区分', () => {
  const p = players(8), settings = { ...E.emptyState().settings, time: '周二 19:00–21:00', durationMinutes: 180 };
  assert.match(E.timeProblem(settings), /180.*超过.*120/);
  assert.throws(() => E.generate(p, settings), /超过/);
  settings.durationMinutes = 60;
  assert.equal(E.timeProblem(settings), '');
  const schedule = E.generate(p, settings, [], rng());
  const text = E.groupText(p, settings, schedule);
  assert.ok(text.includes('19:00–21:00'));
  assert.ok(text.includes('排轮用时：60 分钟（活动时段 120 分钟'));
});
test('时间来源可跨备份保留，旧备份使用手动来源', () => {
  const state = E.emptyState(); state.timeSource = 'retained';
  assert.equal(E.readBackup(state).timeSource, 'retained');
  delete state.timeSource;
  assert.equal(E.readBackup(state).timeSource, 'manual');
});
