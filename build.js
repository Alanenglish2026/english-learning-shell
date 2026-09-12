export const BUILD_VERSION='1.3.1-final-freeze-pwa7';
export const SCHEMA_VERSION=5;
export const MIGRATION_VERSION=5;
export const BUILD=BUILD_VERSION,SCHEMA=SCHEMA_VERSION;
export function checkBuild(value){if(value&&value!==BUILD_VERSION)throw Error('版本更新未完成，请关闭其他学习页面后重新打开。');}
