// mabi-lint.js — checks a Mabinogi Mobile score against the ensemble guidelines
//  1. at most 6 simultaneous notes (6 tracks)
//  2. front tracks are taken first, so no empty track before a used one
//  3. every track starts with the same tempo; one tempo for the whole song
//  4. the same pitch should not sound in two tracks at once (the earlier note is cut)
//  5. every track has the same total length (otherwise it loops on its own in ensemble)
//  6. character limit per track (default 2400)

import { TPQN, MAX_TRACKS, DEFAULT_CHAR_LIMIT, DEFAULT_TEMPO, splitMML, parseTrack, midiToName } from './mabi-mml.js';

export function formatPos(tick, beatsPerBar = 4) {
  const barTicks = beatsPerBar * TPQN;
  const bar = Math.floor(tick / barTicks) + 1;
  const beat = (tick % barTicks) / TPQN + 1;
  return `bar ${bar} beat ${Number.isInteger(beat) ? beat : beat.toFixed(2)}`;
}

/**
 * @param {string[]} parts  one MML string per track (melody first)
 * @param {{charLimit?: number, beatsPerBar?: number, maxClashes?: number}} opts
 */
export function lintParts(parts, opts = {}) {
  const charLimit = opts.charLimit ?? DEFAULT_CHAR_LIMIT;
  const bpb = opts.beatsPerBar ?? 4;
  const maxClashes = opts.maxClashes ?? 20;
  const issues = [];
  const add = (level, code, track, message) => issues.push({ level, code, track, message });

  if (parts.length > MAX_TRACKS) add('error', 'TOO_MANY_TRACKS', null, `${parts.length} tracks; the game plays at most ${MAX_TRACKS}`);

  const parsed = parts.map((p) => parseTrack(p));
  const used = parsed.map((p) => p.notes.length > 0);

  parsed.forEach((p, i) => {
    const t = i + 1;
    for (const e of p.errors) add('error', 'SYNTAX', t, `Position ${e.at}: ${e.message}`);
    // 6. character limit
    if (p.chars > charLimit) add('error', 'CHAR_LIMIT', t, `${p.chars} characters (limit ${charLimit})`);
    else if (p.chars > charLimit * 0.9) add('warn', 'CHAR_NEAR_LIMIT', t, `${p.chars} of ${charLimit} characters`);
  });

  // 2. empty track before a used one
  const lastUsed = used.lastIndexOf(true);
  for (let i = 0; i < lastUsed; i++) {
    if (!used[i]) add('warn', 'EMPTY_BEFORE_USED', i + 1, 'Empty track before a used one; the player assigned here stays silent');
  }

  // 3. tempo
  const firstTempos = [];
  parsed.forEach((p, i) => {
    if (!used[i]) return;
    const head = p.tempos.find((x) => x.beforeNotes);
    if (!head) add('warn', 'TEMPO_MISSING', i + 1, `No tempo before the first note (plays at ${DEFAULT_TEMPO} and may drift in ensemble)`);
    firstTempos.push({ track: i + 1, value: head ? head.value : DEFAULT_TEMPO });
    const values = new Set(p.tempos.map((x) => x.value));
    if (p.tempos.some((x) => !x.beforeNotes) || values.size > 1) add('warn', 'TEMPO_CHANGE', i + 1, 'Tempo changes inside the track; players report playback problems with more than one tempo');
  });
  const distinct = [...new Set(firstTempos.map((x) => x.value))];
  if (distinct.length > 1) add('error', 'TEMPO_MISMATCH', null, 'Tracks start at different tempos: ' + firstTempos.map((x) => `${x.track}=${x.value}`).join(', '));

  // 5. track lengths
  const lens = parsed.map((p, i) => ({ track: i + 1, end: p.endTick })).filter((x) => used[x.track - 1]);
  const ends = [...new Set(lens.map((x) => x.end))];
  if (ends.length > 1) {
    const bars = (t) => (t / (bpb * TPQN)).toFixed(2).replace(/\.00$/, '');
    add('error', 'LENGTH_MISMATCH', null, 'Track lengths differ (bars): ' + lens.map((x) => `${x.track}=${bars(x.end)}`).join(', '));
  }

  // 4. same pitch sounding in two tracks at once
  const byPitch = new Map();
  parsed.forEach((p, i) => {
    for (const n of p.notes) {
      if (!byPitch.has(n.midi)) byPitch.set(n.midi, []);
      byPitch.get(n.midi).push({ s: n.tick, e: n.tick + n.dur, track: i + 1 });
    }
  });
  let clashes = 0;
  for (const [midi, list] of byPitch) {
    list.sort((a, b) => a.s - b.s);
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length && list[b].s < list[a].e; b++) {
        if (list[a].track === list[b].track) continue;
        clashes++;
        if (clashes <= maxClashes) {
          add('warn', 'UNISON_CLASH', null, `${midiToName(midi)} in tracks ${list[a].track} and ${list[b].track} at ${formatPos(Math.max(list[a].s, list[b].s), bpb)}`);
        }
      }
    }
  }
  if (clashes > maxClashes) add('warn', 'UNISON_CLASH', null, `${clashes - maxClashes} more same-pitch overlaps not listed`);

  const stats = parsed.map((p, i) => ({ track: i + 1, chars: p.chars, notes: p.notes.length, endTick: p.endTick, used: used[i] }));
  return { ok: !issues.some((x) => x.level === 'error'), issues, stats };
}

export function lintMML(mml, opts) {
  return lintParts(splitMML(mml), opts);
}
