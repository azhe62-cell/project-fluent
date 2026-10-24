import type { Services } from '../types';
import { LocalAuthService } from './auth';
import { LocalAssessmentService } from './assessment';
import { browserStore, type KeyValueStore } from './storage';

export function createLocalServices(store: KeyValueStore = browserStore(), now?: () => Date): Services {
  const auth = new LocalAuthService(store);
  const assessments = new LocalAssessmentService(store, () => {
    const uid = auth.sessionUserId();
    if (!uid) throw new Error('Not signed in');
    return uid;
  }, now);
  return { mode: 'local', auth, assessments };
}

export { LocalAuthService, LocalAssessmentService };
