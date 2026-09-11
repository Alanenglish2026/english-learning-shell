export const COURSE_LOCK='english-course-library';
export function withCourseLock(fn,locks=globalThis.navigator?.locks){return locks?.request?locks.request(COURSE_LOCK,()=>fn(true)):fn(false);}
