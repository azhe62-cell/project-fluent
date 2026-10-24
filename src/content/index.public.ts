import type { PublicTest } from '@/engine/types';
import { readingMiniMock01 } from './reading-mini-mock-01.public';
export { practiceBank } from './practice-bank.public';

/** Published, listed tests (client-safe). */
export const publishedTests: PublicTest[] = [readingMiniMock01];
export const findTestBySlug = (slug: string) => publishedTests.find((t) => t.slug === slug);
export const findTestById = (id: string) => publishedTests.find((t) => t.id === id);
