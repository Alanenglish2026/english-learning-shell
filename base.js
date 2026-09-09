export const BASE=new URL('./',import.meta.url);
export const here=path=>new URL(path,BASE).href;
