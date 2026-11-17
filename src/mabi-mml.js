// mabi-mml.js — Mabinogi Mobile MML core
// encode: note data -> MML (one string per track, max 6 tracks)
// parse:  MML -> note data (for linting and importing)
//
// Note model: { tick, dur, midi, vol? }  (ticks at TPQN 96; whole note = 384; vol 0-15 = MML v, written only when it changes)
// Song model: { tempo, beatsPerBar?, tracks: [{ notes: [...], volume? }, ...] }
//
// Assumptions not verified in-game are marked ASSUMPTION.

export const TPQN = 96;
export const WHOLE = TPQN * 4; // 384 ticks
export const MAX_TRACKS = 6; // melody + 5 chords
export const DEFAULT_CHAR_LIMIT = 2400; // per track (user-confirmed)
export const OCT_MIN = 1;
export const OCT_MAX = 8;
export const TEMPO_MIN = 32;
export const TEMPO_MAX = 255;
export const DEFAULT_TEMPO = 120;
export const DEFAULT_OCTAVE = 4;
export const DEFAULT_LENGTH = 4;
export const DEFAULT_VOLUME = 8;
// ASSUMPTION: o4c = MIDI 60 and n0 = MIDI 12, as in PC Mabinogi tools.
export const N_OFFSET = 12;
export const N_MAX = 96;
// ASSUMPTION: n<num> takes no length and always uses the current default length (l).

const NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Lengths that divide a whole note exactly (1,2,3,4,6,8,12,16,24,32,48,64), plus dotted forms.
export const LENGTHS = (() => {
  const out = [];
  for (let L = 1; L <= 64; L++) {
    if (WHOLE % L) continue;
    const t = WHOLE / L;
    out.push({ L, dot: false, ticks: t });
    if (t % 2 === 0) out.push({ L, dot: true, ticks: t * 1.5 });
  }
  return out;
})();
const UNDOTTED_L = LENGTHS.filter((x) => !x.dot).map((x) => x.L);
const WHOLE_TOKEN = LENGTHS.find((x) => x.L === 1 && !x.dot);

function lenText(tok, defL) {
  return (tok.L === defL ? '' : String(tok.L)) + (tok.dot ? '.' : '');
}

// ---------- duration splitting (min characters) ----------
const DP_MAX = WHOLE * 2;
const dpCache = new Map();

function dpTable(defL, base, join) {
  const key = `${defL}:${base}:${join}`;
  let t = dpCache.get(key);
  if (t) return t;
  const cost = new Array(DP_MAX + 1).fill(Infinity);
  const pick = new Array(DP_MAX + 1).fill(null);
  cost[0] = 0;
  const toks = LENGTHS.map((tok) => ({ tok, c: base + lenText(tok, defL).length + join }));
  for (let d = 1; d <= DP_MAX; d++) {
    for (const { tok, c } of toks) {
      if (tok.ticks <= d && cost[d - tok.ticks] + c < cost[d]) {
        cost[d] = cost[d - tok.ticks] + c;
        pick[d] = tok;
      }
    }
  }
  t = { cost, pick };
  dpCache.set(key, t);
  return t;
}

function reduce(d) {
  while (d > DP_MAX) d -= WHOLE;
  return d;
}

/** Split a duration into MML length tokens using as few characters as possible. */
export function splitTicks(d, defL = DEFAULT_LENGTH, base = 1, join = 0) {
  const pieces = [];
  while (d > DP_MAX) {
    pieces.push(WHOLE_TOKEN);
    d -= WHOLE;
  }
  const { cost, pick } = dpTable(defL, base, join);
  if (cost[d] === Infinity) return null;
  while (d > 0) {
    const tok = pick[d];
    pieces.push(tok);
    d -= tok.ticks;
  }
  return pieces.sort((a, b) => b.ticks - a.ticks);
}

export function isExpressible(d) {
  if (d === 0) return true;
  if (d < 0) return false;
  return dpTable(DEFAULT_LENGTH, 1, 0).cost[reduce(d)] !== Infinity;
}

/** Nearest duration that MML can express (64th = 6 ticks, 48th = 8 ticks, ...). */
export function fitTicks(d) {
  if (d <= 0) return 0;
  for (let k = 0; k < WHOLE; k++) {
    if (d - k > 0 && isExpressible(d - k)) return d - k;
    if (isExpressible(d + k)) return d + k;
  }
  return d;
}

function octPrefix(cur, oct) {
  const diff = oct - cur;
  if (diff === 0) return '';
  if (Math.abs(diff) <= 2) return (diff > 0 ? '>' : '<').repeat(Math.abs(diff));
  return 'o' + oct;
}

export function midiToName(midi) {
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// ---------- encoding ----------
function normalizeNotes(notes, trackIdx, warnings) {
  const list = notes
    .map((n) => ({ tick: Math.round(n.tick), dur: Math.round(n.dur), midi: Math.round(n.midi), vol: n.vol == null ? null : Math.max(0, Math.min(15, Math.round(n.vol))) }))
    .filter((n) => n.dur > 0 && n.tick >= 0)
    .sort((a, b) => a.tick - b.tick || b.midi - a.midi);
  const out = [];
  for (const n of list) {
    // Range: shift by octaves into o1..o8 (n-command range is narrower, so use o range).
    const lo = (OCT_MIN + 1) * 12;
    const hi = (OCT_MAX + 1) * 12 + 11;
    if (n.midi < lo || n.midi > hi) {
      const orig = n.midi;
      while (n.midi < lo) n.midi += 12;
      while (n.midi > hi) n.midi -= 12;
      warnings.push({ code: 'RANGE_SHIFTED', track: trackIdx + 1, message: `${midiToName(orig)} moved to ${midiToName(n.midi)} (outside o1-o8)` });
    }
    const prev = out[out.length - 1];
    if (prev && n.tick === prev.tick) {
      warnings.push({ code: 'CHORD_DROPPED', track: trackIdx + 1, message: `Two notes start together at tick ${n.tick}; a track plays one note at a time, kept the higher one` });
      continue;
    }
    if (prev && prev.tick + prev.dur > n.tick) {
      prev.dur = n.tick - prev.tick;
      warnings.push({ code: 'OVERLAP_TRUNCATED', track: trackIdx + 1, message: `Overlapping note at tick ${prev.tick} shortened` });
    }
    out.push(n);
  }
  return out;
}

function encodeTrackWithL(notes, defL, o, stats) {
  let s = 't' + o.tempo;
  if (o.volume != null && o.volume !== DEFAULT_VOLUME) s += 'v' + o.volume;
  if (defL !== DEFAULT_LENGTH) s += 'l' + defL;
  let cur = DEFAULT_OCTAVE;
  let curV = o.volume != null ? o.volume : DEFAULT_VOLUME;
  let cursor = 0;

  const restTo = (target) => {
    const gap = target - cursor;
    if (gap <= 0) return;
    const g = fitTicks(gap);
    if (g !== gap) stats.adjusted++;
    s += splitTicks(g, defL, 1, 0).map((t) => 'r' + lenText(t, defL)).join('');
    cursor += g;
  };

  for (const n of notes) {
    restTo(n.tick);
    const dur = fitTicks(n.dur);
    if (dur !== n.dur) stats.adjusted++;
    const oct = Math.floor(n.midi / 12) - 1;
    const name = NAMES[n.midi % 12];
    const pieces = splitTicks(dur, defL, name.length, 1);
    if (n.vol != null && n.vol !== curV) {
      s += 'v' + n.vol;
      curV = n.vol;
    }
    const prefix = octPrefix(cur, oct);
    const nIdx = n.midi - N_OFFSET;
    const singleDefault = pieces.length === 1 && lenText(pieces[0], defL) === '';
    const nText = 'n' + nIdx;
    if (o.useN && singleDefault && nIdx >= 0 && nIdx <= N_MAX && nText.length < prefix.length + name.length) {
      s += nText; // octave unchanged
    } else {
      s += prefix + pieces.map((p) => name + lenText(p, defL)).join('&');
      cur = oct;
    }
    cursor += dur;
  }
  if (o.endTick != null) restTo(o.endTick);
  return s;
}

/** Encode one track; tries every default length and keeps the shortest text. */
export function encodeTrack(notes, o = {}) {
  const opts = { tempo: DEFAULT_TEMPO, useN: true, ...o };
  let best = null;
  for (const L of UNDOTTED_L) {
    const stats = { adjusted: 0 };
    const text = encodeTrackWithL(notes, L, opts, stats);
    if (!best || text.length < best.text.length) best = { text, stats };
  }
  return best;
}

/**
 * Encode a song.
 * opts.useN (default true): use n<num> when it is shorter.
 * opts.padToEnd (default true): pad every track with rests to the same end (guideline 5).
 * opts.padToBar (default true): round the song end up to a full bar.
 */
export function encodeSong(song, opts = {}) {
  const useN = opts.useN ?? true;
  const padToEnd = opts.padToEnd ?? true;
  const padToBar = opts.padToBar ?? true;
  const tempo = song.tempo ?? DEFAULT_TEMPO;
  if (tempo < TEMPO_MIN || tempo > TEMPO_MAX) throw new RangeError(`Tempo must be ${TEMPO_MIN}-${TEMPO_MAX}`);
  const tracks = song.tracks ?? [];
  if (tracks.length > MAX_TRACKS) throw new RangeError(`At most ${MAX_TRACKS} tracks`);
  const barTicks = (song.beatsPerBar ?? 4) * TPQN;

  const warnings = [];
  const cleaned = tracks.map((tr, i) => normalizeNotes(tr.notes ?? [], i, warnings));
  let end = 0;
  for (const ns of cleaned) for (const n of ns) end = Math.max(end, n.tick + n.dur);
  if (opts.endTick != null) end = Math.max(end, opts.endTick); // e.g. bars setting of the editor
  if (padToBar && end > 0) end = Math.ceil(end / barTicks) * barTicks;

  let adjusted = 0;
  const parts = cleaned.map((notes, i) => {
    if (notes.length === 0) return '';
    const r = encodeTrack(notes, { tempo, useN, volume: tracks[i].volume, endTick: padToEnd ? end : null });
    adjusted += r.stats.adjusted;
    return r.text;
  });
  if (adjusted > 0) warnings.push({ code: 'TIMING_ADJUSTED', track: null, message: `${adjusted} durations adjusted to the nearest MML length` });
  return { parts, mml: toMML(parts), endTick: end, warnings };
}

export function toMML(parts) {
  const p = [...parts];
  while (p.length > 1 && p[p.length - 1] === '') p.pop();
  return 'MML@' + p.join(',') + ';';
}

// ---------- parsing ----------
export function splitMML(mml) {
  let s = String(mml).trim();
  if (/^mml@/i.test(s)) s = s.slice(4);
  if (s.endsWith(';')) s = s.slice(0, -1);
  return s.split(',');
}

export function parseTrack(text) {
  const src = String(text).toLowerCase();
  const notes = [];
  const tempos = [];
  const errors = [];
  let i = 0;
  let defTicks = WHOLE / DEFAULT_LENGTH;
  let oct = DEFAULT_OCTAVE;
  let vol = DEFAULT_VOLUME;
  let tick = 0;
  let tie = false;
  let last = null;
  let firstNoteTick = null;

  const err = (at, message) => errors.push({ at, message });
  const num = () => {
    const st = i;
    while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
    return st === i ? null : parseInt(src.slice(st, i), 10);
  };
  const dots = () => {
    let k = 0;
    while (src[i] === '.') {
      k++;
      i++;
    }
    return k;
  };
  const withDots = (base, d) => {
    let total = base;
    let add = base;
    for (let k = 0; k < d; k++) {
      add /= 2;
      total += add;
    }
    return Math.round(total);
  };
  const lenTicks = (n, d, at) => {
    if (n === null) return withDots(defTicks, d);
    if (n < 1 || n > 64) {
      err(at, `Length ${n} out of range 1-64`);
      return withDots(defTicks, d);
    }
    if (WHOLE % n) err(at, `Length ${n} does not divide a whole note evenly at TPQN 96`);
    return withDots(WHOLE / n, d);
  };
  const addNote = (midi, dur) => {
    if (tie && last && last.midi === midi && last.tick + last.dur === tick) {
      last.dur += dur;
    } else {
      last = { tick, dur, midi, vol };
      notes.push(last);
      if (firstNoteTick === null) firstNoteTick = tick;
    }
    tick += dur;
    tie = false;
  };

  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const at = i;
    i++;
    if (ch in PC) {
      let pc = PC[ch];
      if (src[i] === '+' || src[i] === '#') {
        pc++;
        i++;
      } else if (src[i] === '-') {
        pc--;
        i++;
      }
      const dur = lenTicks(num(), dots(), at);
      if (oct < OCT_MIN || oct > OCT_MAX) err(at, `Octave ${oct} out of range ${OCT_MIN}-${OCT_MAX}`);
      addNote((oct + 1) * 12 + pc, dur);
      continue;
    }
    switch (ch) {
      case 't': {
        const v = num();
        if (v === null || v < TEMPO_MIN || v > TEMPO_MAX) err(at, `Tempo must be ${TEMPO_MIN}-${TEMPO_MAX}`);
        else tempos.push({ tick, value: v, beforeNotes: firstNoteTick === null });
        break;
      }
      case 'l': {
        const v = num();
        const d = dots();
        if (v === null || v < 1 || v > 64) err(at, 'l needs a length 1-64');
        else {
          if (WHOLE % v) err(at, `Length ${v} does not divide a whole note evenly at TPQN 96`);
          defTicks = withDots(WHOLE / v, d);
        }
        break;
      }
      case 'o': {
        const v = num();
        if (v === null || v < OCT_MIN || v > OCT_MAX) err(at, `o needs an octave ${OCT_MIN}-${OCT_MAX}`);
        else oct = v;
        break;
      }
      case 'v': {
        const v = num();
        if (v === null || v < 0 || v > 15) err(at, 'v needs a volume 0-15');
        else vol = v;
        break;
      }
      case '<':
        oct--;
        break;
      case '>':
        oct++;
        break;
      case 'r':
        tick += lenTicks(num(), dots(), at);
        tie = false;
        last = null;
        break;
      case '&':
        tie = true;
        break;
      case 'n': {
        const v = num();
        if (v === null || v < 0 || v > N_MAX) err(at, `n needs a note number 0-${N_MAX}`);
        else addNote(v + N_OFFSET, defTicks);
        break;
      }
      default:
        err(at, `Unknown character '${ch}'`);
    }
  }
  return { notes, tempos, endTick: tick, errors, chars: String(text).length };
}

export function parseSong(mml) {
  return splitMML(mml).map(parseTrack);
}
