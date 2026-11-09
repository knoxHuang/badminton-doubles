const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../engine.js');
function rng(seed = 42) { return () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; }; }
function players(n) { return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `球友${i + 1}`, active: true, confirmed: true, note: '' })); }

test('用户接龙：八人、大小写、时间，具体日期不推断', () => {
  const parsed = E.parseRelay(E.SAMPLE);
  assert.deepEqual(parsed.people.map(p => p.name), ['panda', '茶米', 'Knox', 'Syllabear', 'Reus', '长华', '云朵', '歪西']);
  assert.equal(parsed.time, '周二 19:00–21:00');
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
  const p = E.parseRelay(E.SAMPLE).people, settings = { ...E.emptyState().settings, time: '周二 19:00–21:00' };
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
  for (const rounds of [0, 2.5, 101]) assert.throws(() => E.generate(players(4), { ...settings, rounds }), /轮数/);
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
