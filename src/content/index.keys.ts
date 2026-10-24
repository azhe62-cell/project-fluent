import type { AnswerKey } from '@/engine/types';
import { readingMiniMock01Keys } from './reading-mini-mock-01.keys';
import { practiceBankKeys } from './practice-bank.keys';

/** SERVER-ONLY. All answer keys, indexed by question id. */
export const allAnswerKeys: AnswerKey[] = [...readingMiniMock01Keys, ...practiceBankKeys];
export const answerKeyMap = new Map(allAnswerKeys.map((k) => [k.questionId, k]));
