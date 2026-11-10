/* Shared by the browser and Node's built-in test runner. No dependencies. */
(function (root) {
  'use strict';
  const SAMPLE = '#接龙\n周二晚 7-9\n\n1. panda\n2. 茶米\n3. Knox\n4. Syllabear\n5. Reus\n6. 长华\n7. 云朵\n8. 歪西';
  const MAX_PEOPLE = 64;
  const MAX_ROUNDS = 500;
  const PAIRING_VERSION = 2;
  function id() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  function parseTime(text) {
    const match = text.match(/(?<!\d)(周[一二三四五六日天]|星期[一二三四五六日天])?\s*(凌晨|早上|上午|中午|下午|晚上|晚)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*(?:点|时)?\s*[-–—~～至到]\s*(凌晨|早上|上午|中午|下午|晚上|晚)?\s*(\d{1,2})(?:[:：](\d{2}))?(?!\d)/);
    if (!match) return null;
    const [, weekday, startPeriod, startHour, startMinute = '00', endPeriod, endHour, endMinute = '00'] = match;
    if (+startHour > 23 || +endHour > 23 || +startMinute > 59 || +endMinute > 59) return null;
    function hour(value, period) {
      let h = +value;
      if (/凌晨|早上|上午/.test(period || '') && h === 12) return 0;
      if (/晚上|晚/.test(period || '') && h === 12) return 0;
      if (/中午|下午|晚上|晚/.test(period || '') && h < 12) h += 12;
      return h;
    }
    const start = hour(startHour, startPeriod) * 60 + +startMinute;
    let sharedPeriod = endPeriod || startPeriod;
    if (!endPeriod && /晚/.test(startPeriod || '') && start >= 18 * 60 && +endHour < 7) sharedPeriod = '凌晨';
    const end = hour(endHour, sharedPeriod) * 60 + +endMinute;
    const durationMinutes = (end - start + 1440) % 1440;
    if (durationMinutes < 5 || durationMinutes > 720) return null;
    const clock = minutes => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    return { time: `${weekday ? weekday + ' ' : ''}${clock(start)}–${clock(end)}`, durationMinutes };
  }
  function estimateRounds(durationMinutes, matchMinutes) {
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) throw new Error('活动时长需为 5–720 分钟的整数。');
    if (!Number.isInteger(matchMinutes) || matchMinutes < 3 || matchMinutes > 120) throw new Error('平均每场用时需为 3–120 分钟的整数。');
    const estimatedRounds = Math.ceil(durationMinutes / matchMinutes);
    const reserveRounds = Math.max(4, Math.ceil(estimatedRounds * 0.25));
    return { estimatedRounds, reserveRounds, totalRounds: estimatedRounds + reserveRounds };
  }
  function timeProblem(settings) {
    const range = parseTime(settings.time || '');
    if (settings.roundMode === 'auto' && range && settings.durationMinutes > range.durationMinutes) {
      return `可打球时长 ${settings.durationMinutes} 分钟超过活动时间范围的 ${range.durationMinutes} 分钟。请修改活动时间或可打球时长。`;
    }
    return '';
  }
  function parseRelay(raw) {
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const numbered = /^\d{1,3}\s*[.．、)）:：]\s*(.+)$/;
    const hasNumbers = lines.some(s => numbered.test(s));
    const people = [], ignored = [];
    for (const line of lines) {
      const match = line.match(numbered);
      if (hasNumbers && !match) { ignored.push(line); continue; }
      if (!hasNumbers && (/^[#＃]/.test(line) || /^(时间|地点|日期|活动|场地|报名|接龙)[:：]?/.test(line) || parseTime(line) || /周[一二三四五六日天]|星期|\d[:：]\d|\d\s*[-–~至]\s*\d/.test(line))) { ignored.push(line); continue; }
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
    const parsedTime = parseTime(ignored.join(' '));
    return { people, ignored, time: parsedTime?.time || '', durationMinutes: parsedTime?.durationMinutes ?? null };
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
  // Circle rotations partition every possible partnership into disjoint sets.
  function partnerRotations(ids) {
    let ring = [...ids].sort();
    if (ring.length % 2) ring.push(null);
    const rounds = [];
    for (let index = 0; index < ring.length - 1; index++) {
      const teams = [];
      for (let i = 0; i < ring.length / 2; i++) {
        const a = ring[i], b = ring[ring.length - 1 - i];
        if (a !== null && b !== null) teams.push([a, b]);
      }
      rounds.push(teams);
      ring = [ring[0], ring[ring.length - 1], ...ring.slice(1, -1)];
    }
    return rounds;
  }
  function rotationPlan(count, capacity, rotations) {
    const teamsPerRound = capacity * 2;
    const evenGroups = count % 4 === 0 && (count / 2) % teamsPerRound === 0;
    const oneBye = count % 4 === 1 && teamsPerRound === (count - 1) / 2;
    if (!evenGroups && !oneBye) return null;
    return rotations.flatMap(teams => {
      const rounds = [];
      for (let i = 0; i < teams.length; i += teamsPerRound) rounds.push(teams.slice(i, i + teamsPerRound));
      return rounds;
    });
  }
  function samePartners(round, teams) {
    const actual = round.matches.flatMap(m => m.teams).map(t => key(...t)).sort();
    const expected = teams.map(t => key(...t)).sort();
    return actual.length === expected.length && actual.every((pair, i) => pair === expected[i]);
  }
  function lowerCost(a, b) {
    if (!b) return true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  }
  function choosePartners(active, capacity, history, rotations, random) {
    const slots = capacity * 4;
    const ordered = [...active].sort((a, b) => history.counts[a.id] - history.counts[b.id]);
    const cutoff = history.counts[ordered[slots - 1].id];
    const eligible = new Set(active.filter(p => history.counts[p.id] <= cutoff).map(p => p.id));
    const mandatory = active.filter(p => history.counts[p.id] < cutoff).map(p => p.id);
    const frequency = team => history.partners.get(key(...team)) || 0;
    let bestTeams, bestCost;
    function consider(teams) {
      const frequencies = teams.map(frequency);
      const waiting = teams.flat().reduce((sum, id) => sum + (history.last[id] ?? -1), 0);
      const cost = [frequencies.filter(n => n > 0).length, frequencies.reduce((a, b) => a + b, 0), frequencies.reduce((a, b) => a + b * b, 0), waiting];
      if (lowerCost(cost, bestCost)) { bestCost = cost; bestTeams = teams; }
    }
    // Deterministic candidates keep coverage progressing even with an unlucky RNG.
    for (const rotation of rotations) {
      const available = rotation.filter(t => t.every(id => eligible.has(id)));
      const covered = new Set(available.flat());
      if (mandatory.some(id => !covered.has(id))) continue;
      const required = available.filter(t => t.some(id => mandatory.includes(id)));
      const optional = shuffled(available.filter(t => !required.includes(t)), random).sort((a, b) => frequency(a) - frequency(b));
      if (required.length <= capacity * 2 && available.length >= capacity * 2) consider([...required, ...optional.slice(0, capacity * 2 - required.length)]);
    }
    // Search across attendance ties, rather than freezing the same group of four.
    for (let attempt = 0; attempt < 160; attempt++) {
      const selected = shuffled(active, random).sort((a, b) => history.counts[a.id] - history.counts[b.id]).slice(0, slots).map(p => p.id);
      const order = shuffled(selected, random), teams = [];
      for (let i = 0; i < order.length; i += 2) teams.push(order.slice(i, i + 2));
      consider(teams);
    }
    return bestTeams;
  }
  function arrangeOpponents(teams, history, random) {
    let best, bestCost = Infinity;
    for (let attempt = 0; attempt < 40; attempt++) {
      const order = shuffled(teams, random), matches = [];
      let cost = 0;
      for (let i = 0; i < order.length; i += 2) {
        for (const a of order[i]) for (const b of order[i + 1]) cost += (history.opponents.get(key(a, b)) || 0) ** 2;
        matches.push({ court: i / 2 + 1, teams: [order[i].slice(), order[i + 1].slice()] });
      }
      if (cost < bestCost) { bestCost = cost; best = matches; }
      if (cost === 0) break;
    }
    return best;
  }
  function partnerCoverage(people, schedule) {
    const active = people.filter(p => p.active), ids = new Set(active.map(p => p.id));
    const teammates = new Map(active.map(p => [p.id, new Set()]));
    for (const round of schedule) for (const match of round.matches) for (const [a, b] of match.teams) {
      if (ids.has(a) && ids.has(b)) { teammates.get(a).add(b); teammates.get(b).add(a); }
    }
    const byPlayer = active.map(p => ({ id: p.id, covered: teammates.get(p.id).size, total: active.length - 1 }));
    return { coveredPairs: byPlayer.reduce((sum, p) => sum + p.covered, 0) / 2, totalPairs: active.length * (active.length - 1) / 2, completePlayers: byPlayer.filter(p => p.covered === p.total).length, byPlayer };
  }
  function generate(people, settings, locked = [], random = Math.random) {
    const active = validatePeople(people);
    const problem = timeProblem(settings);
    if (problem) throw new Error(problem);
    if (!Number.isInteger(settings.courts) || settings.courts < 1 || settings.courts > 16) throw new Error('场地数需为 1–16 的整数。');
    if (!Number.isInteger(settings.rounds) || settings.rounds < 1 || settings.rounds > MAX_ROUNDS) throw new Error(`总轮数需为 1–${MAX_ROUNDS} 的整数。`);
    if (locked.length >= settings.rounds) throw new Error('所有轮次已完成。如需继续，请增加总轮数。');
    const schedule = JSON.parse(JSON.stringify(locked));
    const history = stats(people, schedule);
    const capacity = Math.min(settings.courts, Math.floor(active.length / 4));
    const rotations = partnerRotations(active.map(p => p.id));
    const plan = rotationPlan(active.length, capacity, rotations);
    const activeIds = new Set(active.map(p => p.id));
    const coveredPairs = new Set(schedule.flatMap(r => r.matches.flatMap(m => m.teams)).filter(t => t.every(id => activeIds.has(id))).map(t => key(...t)));
    const totalPairs = active.length * (active.length - 1) / 2;
    if (settings.roundMode === 'auto' && totalPairs - coveredPairs.size > (MAX_ROUNDS - schedule.length) * capacity * 2) throw new Error(`当前人数与场地无法在 ${MAX_ROUNDS} 轮内搭遍所有人。请增加场地、减少人数，或选择手动轮数安排部分对阵。`);
    // Locked matches from an older algorithm or a changed roster cannot be rewritten.
    const exact = plan && schedule.every((r, index) => samePartners(r, plan[index % plan.length]));
    for (let round = locked.length; round < MAX_ROUNDS && (round < settings.rounds || (settings.roundMode === 'auto' && coveredPairs.size < totalPairs)); round++) {
      const teams = exact ? plan[round % plan.length] : choosePartners(active, capacity, history, rotations, random);
      const best = arrangeOpponents(teams, history, random);
      schedule.push({ matches: best });
      for (const match of best) {
        for (const team of match.teams) {
          const pair = key(...team); history.partners.set(pair, (history.partners.get(pair) || 0) + 1);
          coveredPairs.add(pair);
          for (const player of team) { history.counts[player]++; history.last[player] = round; }
        }
        for (const a of match.teams[0]) for (const b of match.teams[1]) { const pair = key(a, b); history.opponents.set(pair, (history.opponents.get(pair) || 0) + 1); }
      }
    }
    if (settings.roundMode === 'auto' && coveredPairs.size < totalPairs) throw new Error(`尚有搭档组合未覆盖，已达到 ${MAX_ROUNDS} 轮上限。请增加场地、减少人数，或使用手动轮数。`);
    return schedule;
  }
  function appendRounds(people, settings, schedule, extra = 4, random = Math.random) {
    if (!Number.isInteger(extra) || extra < 1) throw new Error('追加轮数需为正整数。');
    if (schedule.length >= MAX_ROUNDS) throw new Error(`单次活动最多保存 ${MAX_ROUNDS} 轮，请导出备份后新建活动。`);
    return generate(people, { ...settings, rounds: Math.min(MAX_ROUNDS, schedule.length + extra) }, schedule, random);
  }
  function groupText(people, settings, schedule, scope = 'all') {
    const names = Object.fromEntries(people.map(p => [p.id, p.name]));
    const lines = [settings.title || '羽毛球双打'];
    if (settings.date || settings.time) lines.push(`时间：${[settings.date, settings.time].filter(Boolean).join(' ')}`);
    if (settings.location) lines.push(`地点：${settings.location}`);
    const range = parseTime(settings.time || '');
    if (settings.roundMode === 'auto' && range && settings.durationMinutes !== range.durationMinutes) lines.push(`排轮用时：${settings.durationMinutes} 分钟（活动时段 ${range.durationMinutes} 分钟，已扣除热身和休息）`);
    lines.push('模式：自由双打轮转');
    if (scope === 'all') lines.push(settings.roundMode === 'auto' ? `预排 ${schedule.length} 轮（含备用，到时间停止，无需全部打完）` : `共 ${schedule.length} 轮`);
    schedule.forEach((round, index) => {
      if (scope !== 'all' && +scope !== index) return;
      lines.push('', `第 ${index + 1} 轮`);
      round.matches.forEach(match => lines.push(`${match.court} 号场：${match.teams.map(team => team.map(id => names[id]).join(' / ')).join(' vs ')}`));
    });
    if (settings.notes) lines.push('', settings.notes);
    return lines.join('\n');
  }
  function emptyState() {
    return { version: 1, raw: '', parsedRaw: '', timeSource: 'manual', pairingVersion: PAIRING_VERSION, people: [], settings: { title: '羽毛球双打', date: '', time: '', location: '', notes: '', courts: 2, roundMode: 'auto', durationMinutes: 120, matchMinutes: 15, rounds: 12 }, schedule: [], completed: 0, stale: false };
  }
  function readBackup(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.people) || value.people.length > MAX_PEOPLE || !value.settings || !Array.isArray(value.schedule) || value.schedule.length > MAX_ROUNDS) throw new Error('不是有效的活动备份。');
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
    for (const [field, max] of [['courts', 16], ['rounds', MAX_ROUNDS]]) {
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
    const oldFormat = value.settings.roundMode === undefined;
    settings.roundMode = oldFormat ? (value.completed ? 'manual' : 'auto') : value.settings.roundMode;
    if (!['auto', 'manual'].includes(settings.roundMode)) throw new Error('备份中的排赛方式无效。');
    settings.durationMinutes = oldFormat ? (parseTime(settings.time)?.durationMinutes || 120) : value.settings.durationMinutes;
    settings.matchMinutes = oldFormat ? 15 : value.settings.matchMinutes;
    const estimate = estimateRounds(settings.durationMinutes, settings.matchMinutes);
    if (oldFormat && settings.roundMode === 'auto') settings.rounds = estimate.totalRounds;
    // A stale backup is allowed, but unsafe unmarked changes must not be shareable.
    const outdatedPairing = value.pairingVersion !== PAIRING_VERSION && schedule.length > value.completed;
    const inconsistent = schedule.length && (outdatedPairing || timeProblem(settings) || schedule.length !== settings.rounds || schedule.slice(value.completed).some(r => r.matches.some(m => m.court > settings.courts || m.teams.flat().some(id => !people.find(p => p.id === id).active))));
    const raw = typeof value.raw === 'string' ? value.raw.slice(0, 50000) : '';
    const parsedRaw = typeof value.parsedRaw === 'string' ? value.parsedRaw.slice(0, 50000) : raw;
    const timeSource = ['manual', 'relay', 'retained'].includes(value.timeSource) ? value.timeSource : 'manual';
    return { version: 1, raw, parsedRaw, timeSource, pairingVersion: PAIRING_VERSION, people, settings, schedule, completed: value.completed, stale: Boolean(value.stale || inconsistent) };
  }
  const api = { SAMPLE, MAX_PEOPLE, MAX_ROUNDS, PAIRING_VERSION, id, parseTime, parseRelay, estimateRounds, timeProblem, generate, appendRounds, stats, partnerCoverage, groupText, emptyState, readBackup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Doubles = api;
})(globalThis);
