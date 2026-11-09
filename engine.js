/* Shared by the browser and Node's built-in test runner. No dependencies. */
(function (root) {
  'use strict';
  const SAMPLE = '#接龙\n周二晚 7-9\n\n1. panda\n2. 茶米\n3. Knox\n4. Syllabear\n5. Reus\n6. 长华\n7. 云朵\n8. 歪西';
  const MAX_PEOPLE = 64;
  function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function parseRelay(raw) {
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const numbered = /^\d{1,3}\s*[.．、)）:：]\s*(.+)$/;
    const hasNumbers = lines.some(s => numbered.test(s));
    const people = [], ignored = [];
    let time = '';
    for (const line of lines) {
      const match = line.match(numbered);
      if (hasNumbers && !match) { ignored.push(line); continue; }
      if (!hasNumbers && (/^[#＃]/.test(line) || /^(时间|地点|日期|活动|场地|报名|接龙)[:：]?/.test(line) || /周[一二三四五六日天]|星期|\d[:：]\d|\d\s*[-–~至]\s*\d/.test(line))) { ignored.push(line); continue; }
      const name = (match ? match[1] : line).trim();
      const uncertain = /[+＋]\s*\d|取消|候补|退出|晚到|早退|两人|夫妻|带[一二三四五六七八九十\d]/.test(name);
      people.push({ id: id(), name, active: true, confirmed: !uncertain, note: uncertain ? '请核对人数和参与状态；多人报名需拆成独立参赛者。' : '' });
    }
    const seen = new Set();
    for (const person of people) {
      if (seen.has(person.name)) {
        for (const duplicate of people.filter(p => p.name === person.name)) {
          duplicate.confirmed = false;
          duplicate.note = '同名记录：请区分显示名，再勾选确认。';
        }
      }
      seen.add(person.name);
    }
    const description = ignored.join(' ');
    const t = description.match(/(周[一二三四五六日天]|星期[一二三四五六日天])?\s*(晚(?:上)?|下午)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*[-–~至]\s*(\d{1,2})(?:[:：](\d{2}))?/);
    if (t) {
      let start = +t[3], end = +t[5];
      if (t[2]) { if (start < 12) start += 12; if (end < 12) end += 12; }
      if (start < 24 && end < 24 && +(t[4] || 0) < 60 && +(t[6] || 0) < 60) time = `${t[1] || ''} ${String(start).padStart(2, '0')}:${t[4] || '00'}–${String(end).padStart(2, '0')}:${t[6] || '00'}`.trim();
    }
    return { people, ignored, time };
  }
  function key(a, b) { return [a, b].sort().join('|'); }
  function stats(people, schedule) {
    const counts = Object.fromEntries(people.map(p => [p.id, 0]));
    const partners = new Map(), opponents = new Map(), last = Object.create(null);
    for (let index = 0; index < schedule.length; index++) {
      for (const match of schedule[index].matches) {
        for (const team of match.teams) {
          const pair = key(...team);
          partners.set(pair, (partners.get(pair) || 0) + 1);
          for (const player of team) {
            counts[player] = (counts[player] || 0) + 1;
            last[player] = index;
          }
        }
        for (const a of match.teams[0]) for (const b of match.teams[1]) {
          const pair = key(a, b);
          opponents.set(pair, (opponents.get(pair) || 0) + 1);
        }
      }
    }
    return { counts, partners, opponents, last };
  }
  function validatePeople(people) {
    if (!Array.isArray(people) || people.length > MAX_PEOPLE) throw new Error(`最多支持 ${MAX_PEOPLE} 位参赛者。`);
    const active = people.filter(p => p.active);
    if (active.length < 4) throw new Error('至少需要 4 位参与者。');
    if (active.some(p => !p.name.trim())) throw new Error('请填写每位参与者的名字。');
    if (active.some(p => !p.confirmed)) throw new Error('请先确认名单中的待核对项。');
    if (new Set(active.map(p => p.name.trim())).size !== active.length) throw new Error('有同名参与者，请修改显示名以便区分。');
    return active;
  }
  function shuffled(values, random) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
  }
  function generate(people, settings, locked = [], random = Math.random) {
    const active = validatePeople(people);
    if (!Number.isInteger(settings.courts) || settings.courts < 1 || settings.courts > 16) throw new Error('场地数需为 1–16 的整数。');
    if (!Number.isInteger(settings.rounds) || settings.rounds < 1 || settings.rounds > 100) throw new Error('总轮数需为 1–100 的整数。');
    if (locked.length >= settings.rounds) throw new Error('所有轮次已完成。如需继续，请增加总轮数。');
    const schedule = JSON.parse(JSON.stringify(locked));
    const history = stats(people, schedule);
    const capacity = Math.min(settings.courts, Math.floor(active.length / 4));
    for (let round = locked.length; round < settings.rounds; round++) {
      // Appearance count is a hard ordering key; waiting time breaks ties.
      const tie = Object.fromEntries(active.map(p => [p.id, random()]));
      const selected = [...active].sort((a, b) => history.counts[a.id] - history.counts[b.id] || (history.last[a.id] ?? -1) - (history.last[b.id] ?? -1) || tie[a.id] - tie[b.id]).slice(0, capacity * 4).map(p => p.id);
      let best, bestCost = Infinity;
      // Bounded search: avoid expensive exhaustive enumeration on a phone.
      for (let attempt = 0; attempt < 160; attempt++) {
        const candidate = shuffled(selected, random), matches = [];
        let cost = 0;
        for (let i = 0; i < candidate.length; i += 4) {
          const [a, b, c, d] = candidate.slice(i, i + 4);
          cost += 100 * ((history.partners.get(key(a, b)) || 0) ** 2 + (history.partners.get(key(c, d)) || 0) ** 2);
          for (const x of [a, b]) for (const y of [c, d]) cost += (history.opponents.get(key(x, y)) || 0) ** 2;
          matches.push({ court: i / 4 + 1, teams: [[a, b], [c, d]] });
        }
        if (cost < bestCost) { bestCost = cost; best = matches; }
        if (cost === 0) break;
      }
      schedule.push({ matches: best });
      for (const match of best) {
        for (const team of match.teams) {
          const pair = key(...team); history.partners.set(pair, (history.partners.get(pair) || 0) + 1);
          for (const player of team) { history.counts[player]++; history.last[player] = round; }
        }
        for (const a of match.teams[0]) for (const b of match.teams[1]) { const pair = key(a, b); history.opponents.set(pair, (history.opponents.get(pair) || 0) + 1); }
      }
    }
    return schedule;
  }
  function groupText(people, settings, schedule, scope = 'all') {
    const names = Object.fromEntries(people.map(p => [p.id, p.name]));
    const lines = [settings.title || '羽毛球双打'];
    if (settings.date || settings.time) lines.push(`时间：${[settings.date, settings.time].filter(Boolean).join(' ')}`);
    if (settings.location) lines.push(`地点：${settings.location}`);
    lines.push('模式：自由双打轮转');
    if (scope === 'all') lines.push(`共 ${schedule.length} 轮`);
    schedule.forEach((round, index) => {
      if (scope !== 'all' && +scope !== index) return;
      lines.push('', `第 ${index + 1} 轮`);
      round.matches.forEach(match => lines.push(`${match.court} 号场：${match.teams.map(team => team.map(id => names[id]).join(' / ')).join(' vs ')}`));
    });
    if (settings.notes) lines.push('', settings.notes);
    return lines.join('\n');
  }
  function emptyState() {
    return { version: 1, raw: '', parsedRaw: '', people: [], settings: { title: '羽毛球双打', date: '', time: '', location: '', notes: '', courts: 2, rounds: 7 }, schedule: [], completed: 0, stale: false };
  }
  function readBackup(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.people) || value.people.length > MAX_PEOPLE || !value.settings || !Array.isArray(value.schedule) || value.schedule.length > 100) throw new Error('不是有效的活动备份。');
    const ids = new Set();
    const people = value.people.map(p => {
      if (!p || typeof p.id !== 'string' || !p.id || p.id.length > 100 || ids.has(p.id) || typeof p.name !== 'string' || p.name.length > 100 || typeof p.active !== 'boolean' || typeof p.confirmed !== 'boolean') throw new Error('备份中的名单无效。');
      ids.add(p.id);
      return { id: p.id, name: p.name, active: p.active, confirmed: p.confirmed, note: typeof p.note === 'string' ? p.note.slice(0, 300) : '' };
    });
    const settings = {};
    for (const field of ['title', 'date', 'time', 'location', 'notes']) {
      if (typeof value.settings[field] !== 'string' || value.settings[field].length > 500) throw new Error('备份中的活动信息无效。');
      settings[field] = value.settings[field];
    }
    for (const [field, max] of [['courts', 16], ['rounds', 100]]) {
      const n = value.settings[field];
      if (!Number.isInteger(n) || n < 1 || n > max) throw new Error('备份中的场地数或轮数无效。');
      settings[field] = n;
    }
    const schedule = value.schedule.map(round => {
      if (!round || !Array.isArray(round.matches) || round.matches.length < 1 || round.matches.length > 16) throw new Error('备份中的轮次无效。');
      const used = new Set(), courts = new Set();
      const matches = round.matches.map(match => {
        if (!match || !Number.isInteger(match.court) || match.court < 1 || match.court > 16 || courts.has(match.court) || !Array.isArray(match.teams) || match.teams.length !== 2) throw new Error('备份中的场地无效。');
        courts.add(match.court);
        const teams = match.teams.map(team => {
          if (!Array.isArray(team) || team.length !== 2) throw new Error('备份中的队伍无效。');
          return team.map(player => {
            if (!ids.has(player) || used.has(player)) throw new Error('备份中有不存在或同轮重复的参赛者。');
            used.add(player); return player;
          });
        });
        return { court: match.court, teams };
      });
      return { matches };
    });
    if (!Number.isInteger(value.completed) || value.completed < 0 || value.completed > schedule.length) throw new Error('备份中的完成进度无效。');
    // A stale backup is allowed, but unsafe unmarked changes must not be shareable.
    const inconsistent = schedule.length && (schedule.length !== settings.rounds || schedule.slice(value.completed).some(r => r.matches.some(m => m.court > settings.courts || m.teams.flat().some(id => !people.find(p => p.id === id).active))));
    const raw = typeof value.raw === 'string' ? value.raw.slice(0, 50000) : '';
    const parsedRaw = typeof value.parsedRaw === 'string' ? value.parsedRaw.slice(0, 50000) : raw;
    return { version: 1, raw, parsedRaw, people, settings, schedule, completed: value.completed, stale: Boolean(value.stale || inconsistent) };
  }
  const api = { SAMPLE, MAX_PEOPLE, id, parseRelay, generate, stats, groupText, emptyState, readBackup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Doubles = api;
})(globalThis);
