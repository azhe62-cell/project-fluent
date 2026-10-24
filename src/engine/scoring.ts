import type {
  AnswerKey, AnswerValue, PublicSection, PublicQuestion, QuestionScore, ScoreResult,
  SectionScore, SkillScore, SkillTag,
} from './types';
import { countWords, isBlank, normaliseText } from './normalize';

/**
 * Raw-mark scoring for Reading-style objective questions.
 * Runs on trusted infrastructure only (Edge Function in the Supabase path).
 * The version string is stored with every result so old results stay interpretable
 * if marking rules change.
 */
export const SCORING_VERSION = 'reading-raw-v1';

export function markQuestion(key: AnswerKey, answer: AnswerValue): Omit<QuestionScore, 'questionId' | 'version'> {
  const max = key.marks;
  if (isBlank(answer)) return { outcome: 'unanswered', awarded: 0, max };
  const rule = key.rule;

  switch (rule.kind) {
    case 'single': {
      // Option IDs are canonical tokens ("A", "TRUE"); exact match only.
      const ok = typeof answer === 'string' && answer === rule.correct;
      return ok ? { outcome: 'correct', awarded: max, max } : { outcome: 'incorrect', awarded: 0, max };
    }
    case 'multi': {
      if (!Array.isArray(answer)) return { outcome: 'incorrect', awarded: 0, max };
      const chosen = [...new Set(answer)];
      // Choosing MORE options than required is invalid and scores zero.
      if (chosen.length > rule.correct.length) return { outcome: 'incorrect', awarded: 0, max };
      const hits = chosen.filter((c) => rule.correct.includes(c)).length;
      if (!rule.partial) {
        const all = hits === rule.correct.length && chosen.length === rule.correct.length;
        return all ? { outcome: 'correct', awarded: max, max } : { outcome: 'incorrect', awarded: 0, max };
      }
      // Documented partial rule: equal share of the marks per correct choice, no negative marking.
      const awarded = (max / rule.correct.length) * hits;
      if (awarded === max) return { outcome: 'correct', awarded, max };
      return awarded > 0 ? { outcome: 'partial', awarded, max } : { outcome: 'incorrect', awarded: 0, max };
    }
    case 'text': {
      if (typeof answer !== 'string') return { outcome: 'incorrect', awarded: 0, max };
      const norm = normaliseText(answer, rule.ignorePunctuation);
      if (norm === '') return { outcome: 'unanswered', awarded: 0, max };
      if (countWords(norm) > rule.maxWords) return { outcome: 'incorrect', awarded: 0, max };
      const accepted = rule.accepted.map((a) => normaliseText(a, rule.ignorePunctuation));
      return accepted.includes(norm)
        ? { outcome: 'correct', awarded: max, max }
        : { outcome: 'incorrect', awarded: 0, max };
    }
  }
}

export interface ScoreInput {
  questions: PublicQuestion[];
  sections: PublicSection[];
  keys: Map<string, AnswerKey> | AnswerKey[];
  responses: Record<string, AnswerValue>;
  scoredAt: string;
}

export function scoreAttempt(input: ScoreInput): ScoreResult {
  const keyMap = Array.isArray(input.keys) ? new Map(input.keys.map((k) => [k.questionId, k])) : input.keys;

  const questionScores: QuestionScore[] = input.questions.map((qn) => {
    const key = keyMap.get(qn.id);
    // A missing key is a content bug. Fail loudly rather than silently scoring zero.
    if (!key) throw new Error(`Missing answer key for question ${qn.id}`);
    if (key.version !== qn.version) throw new Error(`Answer key version mismatch for ${qn.id}`);
    return { questionId: qn.id, version: qn.version, ...markQuestion(key, input.responses[qn.id] ?? null) };
  });

  const byId = new Map(questionScores.map((s) => [s.questionId, s]));
  const counts = { correct: 0, incorrect: 0, partial: 0, unanswered: 0 };
  for (const s of questionScores) counts[s.outcome]++;

  const sectionScores: SectionScore[] = input.sections.map((sec) => {
    const ids = sec.groups.flatMap((g) => g.questionIds);
    const scores = ids.map((id) => byId.get(id)).filter((s): s is QuestionScore => !!s);
    return {
      sectionId: sec.id, title: sec.title,
      awarded: round(scores.reduce((a, s) => a + s.awarded, 0)),
      max: scores.reduce((a, s) => a + s.max, 0),
    };
  });

  // A question contributes to every skill tag it carries (so skill totals overlap by design).
  const skillMap = new Map<SkillTag, SkillScore>();
  for (const qn of input.questions) {
    const s = byId.get(qn.id)!;
    for (const tag of qn.skillTags) {
      const cur = skillMap.get(tag) ?? { skill: tag, awarded: 0, max: 0, questions: 0 };
      cur.awarded += s.awarded; cur.max += s.max; cur.questions += 1;
      skillMap.set(tag, cur);
    }
  }

  return {
    rawScore: round(questionScores.reduce((a, s) => a + s.awarded, 0)),
    maxScore: questionScores.reduce((a, s) => a + s.max, 0),
    counts, questionScores, sectionScores,
    skillScores: [...skillMap.values()].map((s) => ({ ...s, awarded: round(s.awarded) })),
    scoringVersion: SCORING_VERSION,
    scoredAt: input.scoredAt,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
