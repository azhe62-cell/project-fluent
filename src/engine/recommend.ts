import type { PublicQuestion, SkillTag } from './types';
import { SKILL_LABELS } from './labels';
import type { VaultItem } from './vault';

/**
 * Deterministic, explainable practice recommendations — no AI, no randomness.
 *
 *  1. Compute accuracy per skill from the learner's own answers (need ≥ minSample answers).
 *  2. Pick the weakest skills below `weakBelow` accuracy.
 *  3. For each, choose mostly FRESH questions (never answered), nearest to a target
 *     difficulty that eases when accuracy is low; add one previously missed item for revisiting.
 *  4. Never recommend a question the learner has already got right twice.
 *  Every recommendation carries a plain-language reason.
 */

export interface AnswerRecord {
  questionId: string;
  skillTags: SkillTag[];
  correct: boolean;
  at: string;
  source: 'mock' | 'practice' | 'vault';
}

export interface Recommendation {
  skill: SkillTag;
  accuracy: number;
  sampleSize: number;
  targetDifficulty: 1 | 2 | 3;
  reason: string;
  questionIds: string[];
  freshCount: number;
  revisitCount: number;
}

export interface RecommendOptions {
  records: AnswerRecord[];
  bank: PublicQuestion[];
  vault: VaultItem[];
  maxSkills?: number;
  perSkill?: number;
  minSample?: number;
  weakBelow?: number;
}

export function skillStats(records: AnswerRecord[]): Map<SkillTag, { correct: number; total: number }> {
  const m = new Map<SkillTag, { correct: number; total: number }>();
  for (const r of records) for (const t of r.skillTags) {
    const s = m.get(t) ?? { correct: 0, total: 0 };
    s.total++; if (r.correct) s.correct++;
    m.set(t, s);
  }
  return m;
}

export function recommendPractice(o: RecommendOptions): Recommendation[] {
  const { records, bank, vault } = o;
  const maxSkills = o.maxSkills ?? 2, perSkill = o.perSkill ?? 4, minSample = o.minSample ?? 2, weakBelow = o.weakBelow ?? 0.8;

  const answered = new Map<string, { right: number; wrong: number }>();
  for (const r of records) {
    const a = answered.get(r.questionId) ?? { right: 0, wrong: 0 };
    r.correct ? a.right++ : a.wrong++;
    answered.set(r.questionId, a);
  }
  const vaultByQ = new Map(vault.filter((v) => v.status !== 'mastered').map((v) => [v.questionId, v]));

  const weak = [...skillStats(records)]
    .filter(([, s]) => s.total >= minSample && s.correct / s.total < weakBelow)
    .map(([skill, s]) => ({ skill, ...s, accuracy: s.correct / s.total }))
    .sort((a, b) => a.accuracy - b.accuracy || a.skill.localeCompare(b.skill))
    .slice(0, maxSkills);

  const used = new Set<string>();
  const out: Recommendation[] = [];

  for (const w of weak) {
    const target: 1 | 2 | 3 = w.accuracy < 0.5 ? 1 : w.accuracy < 0.75 ? 2 : 3;
    const pool = bank.filter((qn) => qn.skillTags.includes(w.skill) && !used.has(qn.id));
    const byCloseness = (a: PublicQuestion, b: PublicQuestion) =>
      Math.abs(a.difficulty - target) - Math.abs(b.difficulty - target) || a.id.localeCompare(b.id);

    const fresh = pool.filter((qn) => !answered.has(qn.id)).sort(byCloseness);
    const revisit = pool
      .filter((qn) => {
        const a = answered.get(qn.id);
        return a && a.right < 2 && (vaultByQ.has(qn.id) || a.wrong > 0); // missed before, not yet solid
      })
      .sort((a, b) => Date.parse(vaultByQ.get(a.id)?.nextReviewAt ?? '0') - Date.parse(vaultByQ.get(b.id)?.nextReviewAt ?? '0') || a.id.localeCompare(b.id));

    const revisitTarget = Math.min(revisit.length, Math.max(1, Math.floor(perSkill / 4)));
    const freshPicked = fresh.slice(0, perSkill - revisitTarget);
    const revisitPicked = revisit.slice(0, Math.max(revisitTarget, perSkill - freshPicked.length));
    const ids = [...freshPicked, ...revisitPicked].slice(0, perSkill).map((x) => x.id);
    if (ids.length === 0) continue;
    ids.forEach((id) => used.add(id));

    const wrong = w.total - w.correct;
    out.push({
      skill: w.skill, accuracy: w.accuracy, sampleSize: w.total, targetDifficulty: target,
      questionIds: ids,
      freshCount: freshPicked.filter((f) => ids.includes(f.id)).length,
      revisitCount: ids.length - freshPicked.filter((f) => ids.includes(f.id)).length,
      reason: `Recommended because you answered ${wrong} of ${w.total} "${SKILL_LABELS[w.skill]}" questions incorrectly so far. ` +
        `This is a small sample, so treat it as a starting point rather than a verdict.`,
    });
  }
  return out;
}
