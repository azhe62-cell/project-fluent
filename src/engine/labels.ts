import type { QuestionType, SkillTag } from './types';

export const SKILL_LABELS: Record<SkillTag, string> = {
  locating_detail: 'Locating specific detail',
  inference: 'Inference',
  identifying_writer_claims: 'True / False / Not Given reasoning',
  scanning_paragraphs: 'Scanning paragraphs',
  paraphrase_recognition: 'Recognising paraphrase',
  vocabulary_precision: 'Precise word choice',
};

export const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple choice',
  multi_select: 'Choose two',
  true_false_not_given: 'True / False / Not Given',
  matching_information: 'Matching information',
  sentence_completion: 'Sentence completion',
  summary_completion: 'Summary completion',
  short_answer: 'Short answer',
};
